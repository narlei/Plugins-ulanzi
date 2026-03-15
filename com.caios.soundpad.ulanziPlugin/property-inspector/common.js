function getBridgeUrl(settings) {
  return (settings.bridgeUrl || "http://127.0.0.1:18181").replace(/\/$/, "");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fillSelect(selectEl, items, labelKey, valueKey, firstOptionLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  if (firstOptionLabel) {
    const op = document.createElement("option");
    op.value = "";
    op.textContent = firstOptionLabel;
    selectEl.appendChild(op);
  }
  (items || []).forEach((item) => {
    const op = document.createElement("option");
    op.value = String(item[valueKey]);
    op.textContent = String(item[labelKey]);
    selectEl.appendChild(op);
  });
}
