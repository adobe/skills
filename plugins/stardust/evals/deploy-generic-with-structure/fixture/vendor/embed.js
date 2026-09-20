/* loan-calc vendor embed (fixture stand-in for a third-party calculator script).
 * Mounts into [data-widget-id="loan-calc"] and REPLACES its content with the vendor's own
 * markup — the same ~60 words the prototype shows as the default state, plus a vendor footer line.
 * A page whose block leaves the authored default-state copy in place while this runs counts the
 * words twice; a block that removes its authored copy on render counts them once. */
(function mountLoanCalc() {
  const mount = document.querySelector('[data-widget-id="loan-calc"]');
  if (!mount) return;
  const state = { amount: 15000, months: 48, apr: 5.49 };
  const payment = () => { const r = state.apr / 100 / 12; const p = (state.amount * r) / (1 - (1 + r) ** -state.months); return Math.round(p); };
  const render = () => {
    const pay = payment();
    mount.innerHTML = `
      <form class="calc lc-vendor" aria-label="Loan payment calculator">
        <label>Loan amount <input name="amount" type="number" value="${state.amount}" min="1000" max="75000" step="500"></label>
        <label>Term in months <input name="months" type="number" value="${state.months}" min="12" max="84" step="12"></label>
        <label>Loan type <select name="type"><option>Auto, new or used</option><option>Personal, unsecured</option><option>Home equity line</option></select></label>
        <p class="result">Estimated payment <strong>$${pay} a month</strong> at ${state.apr}% APR over ${state.months} months. Total interest $${(pay * state.months - state.amount).toLocaleString('en-US')}.</p>
        <p class="fine">Estimate only. Your rate depends on credit history and the vehicle or collateral. Apply in the app or at any branch for a same-day decision.</p>
        <p class="lc-footer">Calculator provided by LoanCalc Vendor Services.</p>
      </form>`;
    mount.querySelectorAll('input').forEach((el) => el.addEventListener('input', () => { state[el.name] = Number(el.value) || state[el.name]; render(); }));
  };
  render();
})();
