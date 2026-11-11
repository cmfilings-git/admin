# COREBIQ Dashboard UI

## Structure
- `index.html` — dashboard entry point
- `css/index.css` — shared responsive styles
- `js/index.js` — component loader, swipe drawer, chart and demo interactions
- `components/header.html` — desktop header
- `components/sidebar.html` — desktop sidebar
- `components/app/header.html` — mobile header
- `components/app/sidebar.html` — mobile slide-in drawer
- `components/app/bottom-nav.html` — Home / CRM / ERP / HR / Menu
- `components/kpi-welcomecard.html` — welcome banner
- `components/kpi-mini.html` — KPI cards (horizontal row on mobile)
- `components/chart.html` — minimal line-chart mount
- `components/form-view.html` — desktop full-width table and compact mobile one-row task items

## Run
Upload the complete folder to the same web root and open `index.html` through a web server (GitHub Pages, Firebase Hosting, etc.). Components are loaded with `fetch()`, so opening `index.html` directly as a `file://` URL will not load them.

## Link setup
Update `href` values in the component HTML files to match your real module routes. The included module links are examples:
- `modules/crm.html`
- `modules/erp.html`
- `modules/hr.html`
- `modules/clients.html`
- `modules/transactions.html`
- `modules/reports.html`
- `modules/team.html`
- `modules/settings.html`

## Notes
- The mobile drawer opens from the hamburger, Menu bottom tab, or a right-swipe starting at the left screen edge; swipe left inside the drawer to close.
- The mobile KPI cards are horizontally arranged in a row, while the task rows are not horizontally scrollable or draggable.
- Chart.js is loaded from jsDelivr CDN.
- KPI numbers, activity feed, and task rows are demo content. Wire them to your Firebase/Firestore data and real CRUD handlers before production.

## Visual system
The dashboard uses a Google Gemini / Material 3-inspired light visual language: tonal lavender-blue surfaces, rounded containers, pill-shaped controls, subtle elevation, and Lucide outline icons. Lucide is loaded from unpkg; Chart.js is loaded from jsDelivr.
