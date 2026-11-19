'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

const RZP_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RZP_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');
const RZP_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET');
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const WHATSAPP_TOKEN = defineSecret('WHATSAPP_TOKEN');
const WHATSAPP_PHONE_NUMBER_ID = defineSecret('WHATSAPP_PHONE_NUMBER_ID');
const PUBLIC_SITE_URL = defineString('PUBLIC_SITE_URL', { default: 'https://YOUR_DOMAIN' });
const EMAIL_FROM = defineString('EMAIL_FROM', { default: 'CM Innovations <payments@YOUR_DOMAIN>' });
const WHATSAPP_TEMPLATE = defineString('WHATSAPP_TEMPLATE', { default: 'payment_confirmation' });
const MAX_AMOUNT_PAISE = 500000000; // ₹50,00,000 hard ceiling; adjust to business policy.
const MIN_AMOUNT_PAISE = 100; // ₹1.

function razorpay() {
  return new Razorpay({ key_id: RZP_KEY_ID.value(), key_secret: RZP_KEY_SECRET.value() });
}
function fail(code, message) { throw new HttpsError(code, message); }
function cleanText(value, max = 160) {
  return String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, max);
}
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')); }
function validPhone(v) { return /^\+?[1-9]\d{9,14}$/.test(String(v || '').replace(/[\s()-]/g, '')); }
function assertAdmin(request) {
  if (!request.auth || request.auth.token.admin !== true) fail('permission-denied', 'Administrator access required.');
}
function safeEqualHex(a, b) {
  if (!/^[a-f0-9]+$/i.test(a || '') || !/^[a-f0-9]+$/i.test(b || '')) return false;
  const aa = Buffer.from(a, 'hex'); const bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function rateLimit(uidOrIp, action, limit = 8, windowMs = 60000) {
  const id = crypto.createHash('sha256').update(`${action}:${uidOrIp}`).digest('hex');
  const ref = db.collection('rate_limits').doc(id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref); const now = Date.now();
    const data = snap.exists ? snap.data() : {};
    const start = data.windowStart || now; const count = start + windowMs < now ? 0 : (data.count || 0);
    if (count >= limit) fail('resource-exhausted', 'Too many requests. Please wait and try again.');
    tx.set(ref, { windowStart: start + windowMs < now ? now : start, count: count + 1, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs * 2) });
  });
}
function paymentSignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', RZP_KEY_SECRET.value()).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}
async function createReceiptAndNotify(orderDocId, paymentId) {
  const orderRef = db.collection('payment_orders').doc(orderDocId);
  let o;
  const claimed = await db.runTransaction(async tx => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new Error('Payment order missing for receipt.');
    const data = snap.data();
    if (data.receiptGenerated) return false;
    const started = data.receiptGenerationStartedAt?.toMillis?.() || 0;
    if (data.receiptGenerating && Date.now() - started < 5 * 60 * 1000) return false;
    tx.set(orderRef, { receiptGenerating: true, receiptGenerationStartedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    o = data;
    return true;
  });
  if (!claimed) return;
  try {
  const receiptNo = `CMI-${new Date().getUTCFullYear()}-${orderDocId.slice(-8).toUpperCase()}`;
  const pdf = await buildReceiptPdf({ ...o, receiptNo, paymentId });
  const path = `payment-receipts/${orderDocId}/${receiptNo}.pdf`;
  const file = bucket.file(path);
  await file.save(pdf, { resumable: false, metadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-transform' } });
  const [receiptUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  await db.collection('payment_receipts').doc(orderDocId).set({ receiptNo, orderId: o.razorpayOrderId || o.razorpayPaymentLinkId || orderDocId, paymentId, amount: o.amount, currency: o.currency || 'INR', customerEmail: o.customerEmail, receiptPath: path, issuedAt: admin.firestore.FieldValue.serverTimestamp() });
  await orderRef.set({ receiptGenerated: true, receiptNo, receiptPath: path, receiptUrl, receiptIssuedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const emailSent = await sendEmailReceipt(o, pdf, receiptNo, paymentId).catch(async e => { console.error('Email delivery failed', e); await orderRef.set({ emailStatus: 'FAILED', emailError: cleanText(e.message, 180) }, { merge: true }); return false; });
  if (emailSent) await orderRef.set({ emailStatus: 'SENT' }, { merge: true });
  else if (!o.customerEmail) await orderRef.set({ emailStatus: 'SKIPPED' }, { merge: true });
  const whatsappSent = await sendWhatsAppReceipt(o, receiptUrl, receiptNo).catch(async e => { console.error('WhatsApp delivery failed', e); await orderRef.set({ whatsappStatus: 'FAILED', whatsappError: cleanText(e.message, 180) }, { merge: true }); return false; });
  if (whatsappSent) await orderRef.set({ whatsappStatus: 'SENT' }, { merge: true });
  else if (!o.customerPhone) await orderRef.set({ whatsappStatus: 'SKIPPED' }, { merge: true });
  } catch (e) {
    await orderRef.set({ receiptGenerating: false }, { merge: true });
    throw e;
  }
}
function buildReceiptPdf(o) {
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: 'A4', margin: 52 }); const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(21).fillColor('#163d2b').text('CM INNOVATIONS');
    doc.fontSize(9).fillColor('#667085').text('Count. Connect. Grow.');
    doc.moveDown(2).fontSize(19).fillColor('#111827').text('PAYMENT RECEIPT');
    doc.moveDown().fontSize(10).fillColor('#344054');
    const rows = [
      ['Receipt number', o.receiptNo], ['Customer', o.customerName], ['Email', o.customerEmail],
      ['Mobile', o.customerPhone], ['Description', o.description || 'CM Innovations service'],
      ['Razorpay payment ID', o.paymentId], ['Payment date', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
      ['Payment status', 'PAID / CAPTURED']
    ];
    rows.forEach(([k,v]) => { doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }); doc.font('Helvetica').text(String(v || '-')); doc.moveDown(0.5); });
    doc.moveDown().font('Helvetica-Bold').fontSize(15).fillColor('#163d2b').text(`Total paid: ₹${(o.amount / 100).toFixed(2)}`);
    doc.moveDown(2).font('Helvetica').fontSize(9).fillColor('#667085').text('This is a computer-generated receipt. Please retain it for your records.');
    doc.text('CM Innovations | support@cmfilings.com'); doc.end();
  });
}
async function sendEmailReceipt(o, pdf, receiptNo, paymentId) {
  if (!RESEND_API_KEY.value() || !o.customerEmail) return false;
  const base64 = pdf.toString('base64');
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
    from: EMAIL_FROM.value(), to: [o.customerEmail], subject: `Payment received – ${receiptNo}`,
    html: `<p>Thank you for choosing CM Innovations.</p><p>We have received your payment of <strong>₹${(o.amount/100).toFixed(2)}</strong>.</p><p>Receipt: ${receiptNo}<br>Payment ID: ${paymentId}</p><p>Regards,<br>CM Innovations</p>`,
    attachments: [{ filename: `${receiptNo}.pdf`, content: base64 }]
  }) });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  return true;
}
async function sendWhatsAppReceipt(o, receiptUrl, receiptNo) {
  const phone = String(o.customerPhone || '').replace(/\D/g, '');
  if (!WHATSAPP_TOKEN.value() || !WHATSAPP_PHONE_NUMBER_ID.value() || !phone) return false;
  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID.value()}/messages`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${WHATSAPP_TOKEN.value()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
    messaging_product: 'whatsapp', to: phone, type: 'template',
    template: { name: WHATSAPP_TEMPLATE.value(), language: { code: 'en' }, components: [{ type: 'body', parameters: [
      { type: 'text', text: cleanText(o.customerName, 60) }, { type: 'text', text: `₹${(o.amount/100).toFixed(2)}` }, { type: 'text', text: receiptNo }, { type: 'text', text: receiptUrl }
    ] }] }
  }) });
  if (!res.ok) throw new Error(`WhatsApp error ${res.status}: ${await res.text()}`);
  return true;
}
async function markPaid(orderDocId, payment, eventId) {
  const ref = db.collection('payment_orders').doc(orderDocId);
  let shouldIssue = false;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref); if (!snap.exists) throw new Error('Unknown internal order.');
    const d = snap.data();
    if (d.amount !== payment.amount || (d.currency || 'INR') !== payment.currency) throw new Error('Payment amount/currency mismatch.');
    if (d.razorpayOrderId && payment.order_id !== d.razorpayOrderId) throw new Error('Razorpay order mismatch.');
    if (d.status !== 'PAID') {
      tx.set(ref, { status: 'PAID', paymentId: payment.id, paymentMethod: payment.method || null, paidAt: admin.firestore.FieldValue.serverTimestamp(), verifiedBy: eventId || 'checkout-verification' }, { merge: true });
      shouldIssue = true;
    }
    tx.set(db.collection('payment_transactions').doc(payment.id), { orderDocId, razorpayOrderId: payment.order_id || null, paymentId: payment.id, amount: payment.amount, currency: payment.currency, status: payment.status, method: payment.method || null, captured: payment.captured === true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
  if (shouldIssue) await createReceiptAndNotify(orderDocId, payment.id);
}

exports.createRazorpayOrder = onCall({ secrets: [RZP_KEY_ID, RZP_KEY_SECRET], enforceAppCheck: true }, async request => {
  const d = request.data || {}; const name = cleanText(d.name); const email = cleanText(d.email, 254).toLowerCase();
  const phone = cleanText(d.phone, 20); const description = cleanText(d.description || 'CM Innovations payment', 180);
  const amount = Number(d.amountPaise);
  if (!name || !validEmail(email) || !validPhone(phone) || !Number.isSafeInteger(amount) || amount < MIN_AMOUNT_PAISE || amount > MAX_AMOUNT_PAISE) fail('invalid-argument', 'Enter valid customer details and an amount between ₹1 and ₹50,00,000.');
  const ip = request.rawRequest?.ip || request.auth?.uid || 'anonymous'; await rateLimit(ip, 'create-order', 6, 60000);
  const rzp = razorpay(); const internalId = db.collection('payment_orders').doc().id;
  const order = await rzp.orders.create({ amount, currency: 'INR', receipt: `CMI-${internalId.slice(-12)}`, notes: { internalOrderId: internalId, source: 'cm-innovations-website' } });
  await db.collection('payment_orders').doc(internalId).create({ customerName: name, customerEmail: email, customerPhone: phone, description, amount, currency: 'INR', status: 'PENDING', source: 'customer-checkout', razorpayOrderId: order.id, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return { internalOrderId: internalId, orderId: order.id, amount: order.amount, currency: order.currency, keyId: RZP_KEY_ID.value(), brand: 'CM Innovations' };
});

exports.verifyRazorpayPayment = onCall({ secrets: [RZP_KEY_SECRET, RESEND_API_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID], enforceAppCheck: true }, async request => {
  const { internalOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = request.data || {};
  if (![internalOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature].every(v => typeof v === 'string' && v.length < 200)) fail('invalid-argument', 'Invalid verification data.');
  const ref = db.collection('payment_orders').doc(internalOrderId); const snap = await ref.get();
  if (!snap.exists || snap.data().razorpayOrderId !== razorpay_order_id) fail('not-found', 'Payment order not found.');
  if (!paymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) fail('permission-denied', 'Payment signature verification failed.');
  const payment = await razorpay().payments.fetch(razorpay_payment_id);
  if (payment.order_id !== razorpay_order_id || payment.status !== 'captured' || payment.amount !== snap.data().amount || payment.currency !== 'INR') fail('failed-precondition', 'Payment is not captured or does not match the order.');
  await markPaid(internalOrderId, payment, 'checkout-signature-and-api-fetch');
  return { status: 'PAID', receiptNo: (await ref.get()).data().receiptNo || null };
});

exports.createAdminPaymentRequest = onCall({ secrets: [RZP_KEY_ID, RZP_KEY_SECRET], enforceAppCheck: true }, async request => {
  assertAdmin(request); const d = request.data || {};
  const name = cleanText(d.name); const email = cleanText(d.email, 254).toLowerCase(); const phone = cleanText(d.phone, 20);
  const amount = Number(d.amountPaise); const description = cleanText(d.description || 'CM Innovations payment request', 180);
  if (!name || !validEmail(email) || !validPhone(phone) || !Number.isSafeInteger(amount) || amount < MIN_AMOUNT_PAISE || amount > MAX_AMOUNT_PAISE) fail('invalid-argument', 'Invalid payment request details.');
  const internalId = db.collection('payment_orders').doc().id;
  const link = await razorpay().paymentLink.create({ amount, currency: 'INR', accept_partial: false, description, customer: { name, email, contact: phone }, reference_id: internalId.slice(0, 20), notes: { internalOrderId: internalId, source: 'cm-innovations-admin' }, notify: { sms: false, email: false } });
  await db.collection('payment_orders').doc(internalId).create({ customerName: name, customerEmail: email, customerPhone: phone, description, amount, currency: 'INR', status: 'PENDING', source: 'admin-payment-request', razorpayPaymentLinkId: link.id, paymentUrl: link.short_url, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: request.auth.uid });
  return { internalOrderId: internalId, paymentUrl: link.short_url, paymentLinkId: link.id };
});

exports.listAdminPayments = onCall({ enforceAppCheck: true }, async request => {
  assertAdmin(request); const limit = Math.min(Math.max(Number(request.data?.limit) || 50, 1), 100);
  const snap = await db.collection('payment_orders').orderBy('createdAt', 'desc').limit(limit).get();
  return { items: snap.docs.map(x => { const d = x.data(); return { id: x.id, customerName: d.customerName, customerEmail: d.customerEmail, customerPhone: d.customerPhone, description: d.description, amount: d.amount, currency: d.currency, status: d.status, paymentId: d.paymentId || '', source: d.source, createdAt: d.createdAt?.toDate?.().toISOString() || null, receiptUrl: d.receiptUrl || '', paymentUrl: d.paymentUrl || '' }; }) };
});

exports.razorpayWebhook = onRequest({ secrets: [RZP_WEBHOOK_SECRET, RZP_KEY_ID, RZP_KEY_SECRET, RESEND_API_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID], maxInstances: 20 }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const signature = req.get('X-Razorpay-Signature') || ''; const raw = req.rawBody;
  const expected = crypto.createHmac('sha256', RZP_WEBHOOK_SECRET.value()).update(raw).digest('hex');
  if (!safeEqualHex(expected, signature)) return res.status(401).send('Invalid signature');
  let event; try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).send('Invalid JSON'); }
  const eventId = req.get('X-Razorpay-Event-Id') || crypto.createHash('sha256').update(raw).digest('hex');
  const eventRef = db.collection('webhook_events').doc(eventId);
  try {
    const prior = await eventRef.get(); if (prior.exists && prior.data().processed) return res.status(200).send('Already processed');
    await eventRef.set({ event: event.event, receivedAt: admin.firestore.FieldValue.serverTimestamp(), processed: false }, { merge: true });
    const p = event.payload || {};
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const payment = p.payment?.entity || (p.order?.entity?.id ? null : null);
      if (payment) {
        const orderId = payment.order_id; const q = await db.collection('payment_orders').where('razorpayOrderId', '==', orderId).limit(1).get();
        if (!q.empty) await markPaid(q.docs[0].id, payment, eventId);
      }
    } else if (event.event === 'payment_link.paid') {
      const pl = p.payment_link?.entity; const payment = p.payment?.entity;
      if (pl && payment) {
        const q = await db.collection('payment_orders').where('razorpayPaymentLinkId', '==', pl.id).limit(1).get();
        if (!q.empty) {
          const doc = q.docs[0];
          // Payment-link payment is checked against expected amount and captured status.
          const verifiedLinkPayment = await razorpay().payments.fetch(payment.id);
          if (verifiedLinkPayment.status === 'captured' && verifiedLinkPayment.amount === doc.data().amount && verifiedLinkPayment.currency === 'INR') {
            await doc.ref.set({ status: 'PAID', paymentId: verifiedLinkPayment.id, paidAt: admin.firestore.FieldValue.serverTimestamp(), verifiedBy: eventId }, { merge: true });
            await db.collection('payment_transactions').doc(payment.id).set({ orderDocId: doc.id, paymentId: payment.id, amount: payment.amount, currency: payment.currency, status: payment.status, captured: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            await createReceiptAndNotify(doc.id, verifiedLinkPayment.id);
          }
        }
      }
    } else if (event.event === 'payment.failed') {
      const payment = p.payment?.entity;
      if (payment?.order_id) {
        const q = await db.collection('payment_orders').where('razorpayOrderId', '==', payment.order_id).limit(1).get();
        if (!q.empty) await q.docs[0].ref.set({ lastFailureAt: admin.firestore.FieldValue.serverTimestamp(), lastFailureCode: cleanText(payment.error_code, 80), lastFailureDescription: cleanText(payment.error_description, 200) }, { merge: true });
      }
    }
    await eventRef.set({ processed: true, processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).send('OK');
  } catch (e) { console.error('Webhook processing failed', e); return res.status(500).send('Retry later'); }
});
