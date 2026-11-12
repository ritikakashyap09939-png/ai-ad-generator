(function initThemeSwitcher() {
  var dots = document.querySelectorAll('.theme-dot');
  function setActive(theme) {
    dots.forEach(function (d) {
      if (d.dataset.theme === theme) d.classList.add('active');
      else d.classList.remove('active');
    });
  }
  var current = document.documentElement.dataset.theme || 'purple';
  setActive(current);
  dots.forEach(function (dot) {
    dot.addEventListener('click', function () {
      var theme = dot.dataset.theme;
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem('adgen-theme', theme); } catch (e) {}
      setActive(theme);
    });
  });
})();

const form = document.getElementById('ad-form');
const generateBtn = document.getElementById('generate-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const emptyStateEl = document.getElementById('empty-state');

const productInput = document.getElementById('productName');
const genderInput = document.getElementById('gender');
const ageFromInput = document.getElementById('age-from');
const ageToInput = document.getElementById('age-to');
const toneInput = document.getElementById('tone');

const errProduct = document.getElementById('err-product');
const errAge = document.getElementById('err-age');

const previewHeadline = document.getElementById('preview-headline');
const previewDesc = document.getElementById('preview-desc');
const headlinesEl = document.getElementById('headlines');
const toggleHeadlinesBtn = document.getElementById('toggle-headlines');
const descriptionsEl = document.getElementById('descriptions');
const keywordsEl = document.getElementById('keywords');
const copyAllKeywordsBtn = document.getElementById('copy-all-keywords');
const posterTextEl = document.getElementById('poster-text');
const copyPosterBtn = document.getElementById('copy-poster');

let allHeadlines = [];
let headlinesExpanded = false;

function setupChipGroup(containerId, hiddenInput, dataAttr) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach((c) => {
        c.classList.remove('selected');
        c.setAttribute('aria-checked', 'false');
      });
      chip.classList.add('selected');
      chip.setAttribute('aria-checked', 'true');
      hiddenInput.value = chip.dataset[dataAttr] || hiddenInput.value;
    });
  });
}

setupChipGroup('gender-chips', genderInput, 'gender');
setupChipGroup('tone-chips', toneInput, 'tone');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const productName = productInput.value.trim();
  const gender = genderInput.value || 'Everyone';
  const ageFromStr = ageFromInput.value;
  const ageToStr = ageToInput.value;
  const tone = toneInput.value.trim() || 'Friendly';

  let hasError = false;
  if (!productName) {
    errProduct.textContent = 'Please write your product name first.';
    productInput.classList.add('input-error');
    hasError = true;
  }
  if (ageFromStr === '' || ageToStr === '') {
    errAge.textContent = 'Please enter both ages.';
    if (ageFromStr === '') ageFromInput.classList.add('input-error');
    if (ageToStr === '') ageToInput.classList.add('input-error');
    hasError = true;
  } else {
    const ageFrom = Number(ageFromStr);
    const ageTo = Number(ageToStr);
    if (ageFrom > ageTo) {
      errAge.textContent = 'Starting age must be smaller than ending age.';
      ageFromInput.classList.add('input-error');
      ageToInput.classList.add('input-error');
      hasError = true;
    }
  }
  if (hasError) return;

  const ageFrom = Number(ageFromStr);
  const ageTo = Number(ageToStr);
  let prefix = 'People';
  if (gender === 'Women') prefix = 'Women';
  else if (gender === 'Men') prefix = 'Men';
  const audience = `${prefix} aged ${ageFrom}-${ageTo}`;

  setStatus('', '');
  generateBtn.disabled = true;
  generateBtn.textContent = 'Creating your ad...';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName, audience, tone }),
      signal: controller.signal
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to generate ads');
    }

    renderResults(data);
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');
    generateBtn.textContent = 'Create again';
  } catch (err) {
    if (err && err.name === 'AbortError') {
      setStatus('Server busy hai, please dobara try karo', 'error');
    } else {
      setStatus(err.message || 'Something went wrong.', 'error');
    }
    generateBtn.textContent = 'Create my ad';
  } finally {
    clearTimeout(timeoutId);
    generateBtn.disabled = false;
  }
});

function clearErrors() {
  errProduct.textContent = '';
  errAge.textContent = '';
  productInput.classList.remove('input-error');
  ageFromInput.classList.remove('input-error');
  ageToInput.classList.remove('input-error');
  setStatus('', '');
}

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

function renderResults(data) {
  const headlines = Array.isArray(data.headlines) ? data.headlines : [];
  const descriptions = Array.isArray(data.descriptions) ? data.descriptions : [];
  const keywords = Array.isArray(data.keywords) ? data.keywords : [];
  const posterIdea = data.posterIdea || '';

  renderPreview(headlines, descriptions);
  renderHeadlines(headlines);
  renderDescriptions(descriptions);
  renderKeywords(keywords);
  renderPoster(posterIdea);
}

function renderPreview(headlines, descriptions) {
  const h1 = headlines[0] || '';
  const h2 = headlines[1] || '';
  previewHeadline.textContent = [h1, h2].filter(Boolean).join(' | ');
  previewDesc.textContent = descriptions[0] || '';
}

function renderHeadlines(headlines) {
  allHeadlines = headlines;
  headlinesExpanded = false;
  headlinesEl.innerHTML = '';
  const toShow = headlines.slice(0, 5);
  toShow.forEach((text) => headlinesEl.appendChild(makeTitleItem(text)));

  if (headlines.length > 5) {
    toggleHeadlinesBtn.textContent = `Show all ${headlines.length} titles`;
    toggleHeadlinesBtn.classList.remove('hidden');
  } else {
    toggleHeadlinesBtn.classList.add('hidden');
  }
}

toggleHeadlinesBtn.addEventListener('click', () => {
  headlinesExpanded = !headlinesExpanded;
  headlinesEl.innerHTML = '';
  const toShow = headlinesExpanded ? allHeadlines : allHeadlines.slice(0, 5);
  toShow.forEach((text) => headlinesEl.appendChild(makeTitleItem(text)));
  toggleHeadlinesBtn.textContent = headlinesExpanded ? 'Show fewer' : `Show all ${allHeadlines.length} titles`;
});

function makeTitleItem(text) {
  const li = document.createElement('li');
  li.className = 'item';

  const textWrap = document.createElement('div');
  textWrap.className = 'item-text';
  const span = document.createElement('span');
  span.textContent = text;
  const meta = document.createElement('span');
  meta.className = 'item-meta';
  meta.textContent = `${text.length}/30`;
  textWrap.appendChild(span);
  textWrap.appendChild(meta);

  li.appendChild(textWrap);
  li.appendChild(makeCopyButton(text));
  return li;
}

function renderDescriptions(descriptions) {
  descriptionsEl.innerHTML = '';
  descriptions.forEach((text) => {
    const li = document.createElement('li');
    li.className = 'item';

    const textWrap = document.createElement('div');
    textWrap.className = 'item-text';
    const span = document.createElement('span');
    span.textContent = text;
    textWrap.appendChild(span);

    li.appendChild(textWrap);
    li.appendChild(makeCopyButton(text));
    descriptionsEl.appendChild(li);
  });
}

function renderKeywords(keywords) {
  keywordsEl.innerHTML = '';
  keywords.forEach((kw) => {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    chip.textContent = kw;
    keywordsEl.appendChild(chip);
  });
  copyAllKeywordsBtn.onclick = async () => {
    const text = keywords.join(', ');
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(copyAllKeywordsBtn, 'Copy all words');
    } catch {
      fallbackCopy(text);
      flashCopied(copyAllKeywordsBtn, 'Copy all words');
    }
  };
}

function renderPoster(text) {
  posterTextEl.textContent = text;
  copyPosterBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(copyPosterBtn, 'Copy');
    } catch {
      fallbackCopy(text);
      flashCopied(copyPosterBtn, 'Copy');
    }
  };
}

function makeCopyButton(text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(btn, 'Copy');
    } catch {
      fallbackCopy(text);
      flashCopied(btn, 'Copy');
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

function flashCopied(btn, original) {
  btn.textContent = '✓ Copied';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 1500);
}
