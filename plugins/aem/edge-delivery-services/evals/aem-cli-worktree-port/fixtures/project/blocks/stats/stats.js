export default function decorate(block) {
  [...block.children].forEach((row) => {
    row.classList.add('stats-item');
    const [value, label] = row.children;
    value?.classList.add('stats-value');
    label?.classList.add('stats-label');
  });
}
