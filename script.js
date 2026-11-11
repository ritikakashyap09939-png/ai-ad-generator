const form = document.getElementById('ad-form');
const generateBtn = document.getElementById('generate-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

const headlinesEl = document.getElementById('headlines');
const descriptionsEl = document.getElementById('descriptions');
const keywordsEl = document.getElementById('keywords');
const posterEl = document.getElementById('poster');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const productName = document.getElementById('productName').value.trim();
  const audience = document.getElementById('audience').value.trim();
  const tone = document.getElementById('tone').value.trim();

  setStatus('Generating ads...', '');
  generateBtn.disabled = true;
  resultsEl.classList.add('hidden');

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName, audience, tone })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to generate ads');
    }

    renderResults(data);
    setStatus('Generated successfully.', 'success');
    resultsEl.classList.remove('hidden');
  } catch (err) {
    setStatus(err.message || 'Something went wrong.', 'error');
  } finally {
    generateBtn.disabled = false;
  }
});

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

function renderResults(data) {
  renderList(headlinesEl, data.headlines || [], 30);
  renderList(descriptionsEl, data.descriptions || [], 90);
  renderList(keywordsEl, data.keywords || [], null);
  renderPoster(data.posterIdea || '');
}

function renderList(container, items, maxLen) {
  container.innerHTML = '';
  items.forEach((text) => {
    const li = document.createElement('li');
    li.className = 'item';

    const textWrap = document.createElement('div');
    textWrap.className = 'item-text';

    const span = document.createElement('span');
    span.textContent = text;
    textWrap.appendChild(span);

    if (typeof maxLen === 'number') {
      const meta = document.createElement('span');
      meta.className = 'item-meta';
      meta.textContent = `(${text.length}/${maxLen})`;
      textWrap.appendChild(meta);
    }

    const btn = makeCopyButton(text);
    li.appendChild(textWrap);
    li.appendChild(btn);
    container.appendChild(li);
  });
}

function renderPoster(text) {
  posterEl.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'poster-text';
  p.textContent = text;
  const btn = makeCopyButton(text);
  posterEl.appendChild(p);
  posterEl.appendChild(btn);
}

function makeCopyButton(text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(btn);
    } catch {
      fallbackCopy(text);
      flashCopied(btn);
    }
  });
  return btn;
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function flashCopied(btn) {
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 1200);
}
