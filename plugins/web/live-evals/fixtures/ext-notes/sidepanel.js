document.getElementById('save').addEventListener('click', async () => {
  const note = document.getElementById('note').value;
  await chrome.storage.local.set({ note });
  document.getElementById('status').textContent = `Saved: ${note}`;
});
