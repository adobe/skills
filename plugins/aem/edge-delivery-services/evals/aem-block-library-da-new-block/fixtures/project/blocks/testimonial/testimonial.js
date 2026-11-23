export default function decorate(block) {
  const [quoteRow, personRow] = block.children;
  quoteRow?.classList.add('testimonial-quote');
  personRow?.classList.add('testimonial-person');
  const avatar = personRow?.querySelector('picture');
  if (avatar) avatar.closest('div').classList.add('testimonial-avatar');
  else block.classList.add('no-avatar');
}
