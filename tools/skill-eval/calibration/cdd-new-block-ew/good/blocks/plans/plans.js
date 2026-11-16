export function savingPercent(monthly, annualPerMonth) {
  if (!(monthly > 0) || !(annualPerMonth >= 0) || annualPerMonth > monthly) return 0;
  return Math.round((1 - annualPerMonth / monthly) * 100);
}

export function readPrice(text) {
  const match = /\d+(?:[.,]\d+)?/.exec(text || '');
  return match ? Number(match[0].replace(',', '.')) : NaN;
}

function setPeriod(block, period) {
  block.dataset.period = period;
  block.querySelectorAll('.plans-toggle button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.period === period));
  });
  block.querySelectorAll('.plans-card').forEach((card) => {
    const [monthly, annual] = card.querySelectorAll('.plans-prices p');
    if (monthly) monthly.hidden = period !== 'monthly';
    if (annual) annual.hidden = period !== 'annual';
    const saving = card.querySelector('.plans-saving');
    if (saving) saving.hidden = period !== 'annual' || !saving.textContent;
  });
}

export default function decorate(block) {
  const list = document.createElement('ul');
  list.className = 'plans-list';
  [...block.children].forEach((row) => {
    const [name, prices, features, cta] = [...row.children];
    const card = document.createElement('li');
    card.className = 'plans-card';
    if (name) card.append(...name.childNodes);
    if (prices) {
      const wrap = document.createElement('div');
      wrap.className = 'plans-prices';
      wrap.append(...prices.childNodes);
      card.append(wrap);
      const [monthly, annual] = [...wrap.querySelectorAll('p')].map((p) => readPrice(p.textContent));
      const percent = savingPercent(monthly, annual);
      const saving = document.createElement('p');
      saving.className = 'plans-saving';
      saving.textContent = percent ? `Save ${percent}% with annual billing` : '';
      card.append(saving);
    }
    if (features) card.append(...features.childNodes);
    if (cta) card.append(...cta.childNodes);
    list.append(card);
  });

  const toggle = document.createElement('div');
  toggle.className = 'plans-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Billing period');
  ['monthly', 'annual'].forEach((period) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.period = period;
    button.textContent = period === 'monthly' ? 'Monthly' : 'Annual';
    button.addEventListener('click', () => setPeriod(block, period));
    toggle.append(button);
  });

  block.replaceChildren(toggle, list);
  setPeriod(block, 'monthly');
}
