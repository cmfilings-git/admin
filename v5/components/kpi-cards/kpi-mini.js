import { renderKpiCards } from './kpi-mini.js';

renderKpiCards(document.getElementById('kpiGrid'), [
  {
    label: 'Total clients',
    icon: 'users',
    tone: 'blue',
    value: '1,248',
    badge: { type: 'positive', icon: 'trending-up', text: '8.2%' },
    footText: 'vs last month'
  },
  {
    label: 'Monthly revenue',
    icon: 'wallet',
    tone: 'green',
    value: '₹4.82L',
    badge: { type: 'positive', icon: 'trending-up', text: '12.5%' },
    footText: 'vs last month'
  },
  {
    label: 'Pending tasks',
    icon: 'clipboard-list',
    tone: 'orange',
    value: '36',
    footText: '12 due this week'
  },
  {
    label: 'Team members',
    icon: 'users-round',
    tone: 'violet',
    value: '18',
    footText: '16 active today'
  }
]);
