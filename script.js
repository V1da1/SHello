// --- Settings accessor
function getSettings() {
  try { return JSON.parse(localStorage.getItem('sp.settings') || '{}'); } catch { return {}; }
}

// --- Command-line search + autocomplete + calculator
(function initCommandSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  const searchWrap = document.querySelector('.search-wrapper');
  if (!form || !input) return;

  let lastCalcResult = null;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;

    // Calculator
    const calcAttempt = evaluateCalculator(raw, lastCalcResult);
    if (calcAttempt.didEvaluate) {
      lastCalcResult = calcAttempt.result;
      input.value = String(calcAttempt.result);
      resetSearchUI();
      return;
    }

    // Bookmarks
    const { matches, exactUrl } = computeBookmarkMatches(raw);

    // Only navigate on exact title match
    if (exactUrl) {
      window.location.href = exactUrl;
      return;
    }

    // Otherwise search (covers 0 matches OR 1+ prefix matches that aren't exact)
    window.location.href = `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
  });

  input.addEventListener('input', () => {
    const q = input.value;
    if (lastCalcResult !== null) {
      if (!/^\s*[+\-*/]/.test(q)) lastCalcResult = null;
    }
    const normalized = q.trim();
    const { matches } = computeBookmarkMatches(normalized);
    renderSearchUI(normalized, matches, { live: true });
    if (searchWrap) searchWrap.classList.toggle('searching', normalized.length > 0);
  });

  function resetSearchUI() {
    const scroller = document.querySelector('.categories');
    if (!scroller) return;
    scroller.querySelectorAll('.category').forEach(cat => cat.classList.remove('is-hidden', 'has-matches'));
    scroller.querySelectorAll('.category-links a').forEach(a => {
      const title = a.getAttribute('data-title') || a.textContent || '';
      const iconEl = a.querySelector('img');
      a.innerHTML = `${iconEl ? `<img class="link-icon" src="${iconEl.src}" alt="" /> ` : ''}${escapeHtml(title)}`;
      a.setAttribute('data-title', title);
      a.classList.remove('is-match');
    });
  }

  function renderSearchUI(query, matches) {
    const scroller = document.querySelector('.categories');
    if (!scroller) return;
    resetSearchUI();
    if (!query) return;

    const catToMatchCount = new Map();
    for (const m of matches) {
      catToMatchCount.set(m.categoryEl, (catToMatchCount.get(m.categoryEl) || 0) + 1);
      const a = m.aEl;
      const icon = a.querySelector('img');
      const rest = m.title.slice(query.length);
      const highlighted = `<span class="match-highlight">${escapeHtml(m.title.slice(0, query.length))}</span>${escapeHtml(rest)}`;
      a.innerHTML = `${icon ? `<img class="link-icon" src="${icon.src}" alt="" /> ` : ''}${highlighted}`;
      a.classList.add('is-match');
    }
    scroller.querySelectorAll('.category').forEach(cat => {
      const count = (catToMatchCount.get(cat) || 0);
      if (count === 0) cat.classList.add('is-hidden');
      else cat.classList.add('has-matches');
    });
  }

  function computeBookmarkMatches(query) {
    const out = [];
    let exactUrl = null;
    const scroller = document.querySelector('.categories');
    if (!scroller) return { matches: out, exactUrl };
    const q = (query || '').toLowerCase();
    scroller.querySelectorAll('.category').forEach(cat => {
      cat.querySelectorAll('.category-links li a').forEach(a => {
        const title = (a.getAttribute('data-title') || a.textContent || '').trim();
        a.setAttribute('data-title', title);
        const lower = title.toLowerCase();
        if (q && lower.startsWith(q)) {
          out.push({ categoryEl: cat, aEl: a, title, url: a.href });
        }
        if (q && lower === q) {
          exactUrl = a.href;
        }
      });
    });
    return { matches: out, exactUrl };
  }

  function evaluateCalculator(input, last) {
    if (last !== null && /^\s*[+\-*/]/.test(input)) input = String(last) + ' ' + input;
    if (!/^\s*[+\-]?\s*(?:\d+(?:\.\d+)?)(?:\s*[+\-*/]\s*\d+(?:\.\d+)?\s*)*$/.test(input)) {
      return { didEvaluate: false };
    }
    try {
      const result = evaluateExpression(input);
      if (!Number.isFinite(result)) return { didEvaluate: false };
      return { didEvaluate: true, result };
    } catch { return { didEvaluate: false }; }
  }

  function evaluateExpression(expr) {
    const tokens = []; const re = /\d+(?:\.\d+)?|[+\-*/]/g; let m;
    while ((m = re.exec(expr))) { tokens.push(m[0]); }
    if (tokens.length === 0) throw new Error('no tokens');
    const out = [], ops = [], prec = { '+': 1, '-': 1, '*': 2, '/': 2 }, isOp = t => ['+', '-', '*', '/'].includes(t);
    for (const t of tokens) { if (isOp(t)) { while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop()); ops.push(t); } else out.push(parseFloat(t)); }
    while (ops.length) out.push(ops.pop());
    const st = [];
    for (const t of out) {
      if (typeof t === 'number') st.push(t);
      else { const b = st.pop(), a = st.pop(); st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : a / b); }
    }
    if (st.length !== 1) throw new Error('bad expr');
    return st[0];
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
})();

// --- Clock
function updateClock() {
  const now = new Date();
  const settings = getSettings();
  const options = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: settings.clock12h === true };
  document.getElementById("clock").textContent = now.toLocaleTimeString("en-US", options);
}
clearInterval(window.__clockInterval);
window.__clockInterval = setInterval(updateClock, 1000);
updateClock();

// --- Discrete category navigation (wheel/keys/drag)
(function enableDiscreteCategoryNav() {
  const scroller = document.querySelector('.categories');
  if (!scroller) return;

  const getStep = () => {
    const firstCard = scroller.querySelector('.category');
    if (!firstCard) return 0;
    const cardRect = firstCard.getBoundingClientRect();
    const style = getComputedStyle(scroller);
    const gapPx = parseFloat(style.columnGap || style.gap || '0') || 0;
    return cardRect.width + gapPx;
  };

  const getMaxIndex = () => {
    const total = scroller.querySelectorAll('.category').length;
    const step = getStep();
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const geometryMaxIndex = step > 0 ? Math.round(maxScroll / step) : 0;
    const countBasedMaxIndex = Math.max(0, total - 4);
    return Math.max(geometryMaxIndex, countBasedMaxIndex);
  };

  const getIndex = () => {
    const step = getStep();
    if (!step) return 0;
    return Math.round(scroller.scrollLeft / step);
  };

  const goToIndex = (index) => {
    const step = getStep();
    if (!step) return;
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const clampedIndex = Math.max(0, Math.min(getMaxIndex(), index));
    const targetLeft = Math.min(clampedIndex * step, maxScroll);
    scroller.scrollTo({ left: targetLeft, behavior: 'smooth' });
  };

  const scrollByOne = (direction) => {
    const current = getIndex();
    goToIndex(current + (direction > 0 ? 1 : -1));
  };

  let wheelLocked = false;
  scroller.addEventListener('wheel', (e) => {
    const magnitude = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? Math.abs(e.deltaY) : Math.abs(e.deltaX);
    if (magnitude < 1) return;
    e.preventDefault();
    if (wheelLocked) return;
    wheelLocked = true;
    const direction = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) > 0 ? 1 : -1;
    scrollByOne(direction);
    setTimeout(() => { wheelLocked = false; }, 200);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollByOne(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollByOne(-1); }
  });

  let isDragging = false, startX = 0, totalDx = 0;
  const pointerDown = (e) => { isDragging = true; startX = e.clientX; totalDx = 0; scroller.setPointerCapture?.(e.pointerId); };
  const pointerMove = (e) => { if (!isDragging) return; totalDx = e.clientX - startX; };
  const pointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false; scroller.releasePointerCapture?.(e.pointerId);
    const threshold = Math.max(30, getStep() * 0.15);
    if (Math.abs(totalDx) >= threshold) scrollByOne(totalDx < 0 ? 1 : -1);
  };
  scroller.addEventListener('pointerdown', pointerDown);
  scroller.addEventListener('pointermove', pointerMove);
  scroller.addEventListener('pointerup', pointerUp);
  scroller.addEventListener('pointercancel', pointerUp);
})();

// --- Weather, Todoist, Settings
(function initLastContainer() {
  const weatherBody = document.getElementById('weather-body');
  const weatherLoc = document.getElementById('weather-location');
  const todoList = document.getElementById('todoist-list');
  const todoProj = document.getElementById('todoist-project');
  const settingsBtn = document.getElementById('open-settings');
  const overlay = document.getElementById('settings-overlay');
  const closeBtn = document.getElementById('close-settings');
  const form = document.getElementById('settings-form');
  const editor = document.getElementById('categories-editor');

  if (settingsBtn) settingsBtn.addEventListener('click', openOverlay);
  if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

  function openOverlay() {
    if (!overlay) return;
    overlay.classList.remove('hidden'); overlay.classList.add('show'); overlay.setAttribute('aria-hidden', 'false');
    populateForm();
  }
  function closeOverlay() {
    if (!overlay) return;
    overlay.classList.remove('show'); overlay.classList.add('closing');
    const onEnd = () => { overlay.classList.remove('closing'); overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true'); overlay.removeEventListener('animationend', onEnd); };
    overlay.addEventListener('animationend', onEnd);
  }

  function saveSettings(next) { localStorage.setItem('sp.settings', JSON.stringify(next)); }
  window.getSettings = getSettings;

  async function loadWeather() {
    if (!weatherBody) return;
    const s = getSettings();
    if (!s.weather || typeof s.weather.lat !== 'number' || typeof s.weather.lon !== 'number' || Number.isNaN(s.weather.lat) || Number.isNaN(s.weather.lon)) {
      if (weatherLoc) weatherLoc.textContent = 'Configure in settings';
      weatherBody.innerHTML = '';
      return;
    }
    const { lat, lon } = s.weather;
    const tempUnit = (s.tempImperial ? 'fahrenheit' : 'celsius');
    const windUnit = (s.windImperial ? 'mph' : 'kmh');
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code,is_day&temperature_unit=${encodeURIComponent(tempUnit)}&windspeed_unit=${encodeURIComponent(windUnit)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('weather fetch failed');
      const data = await res.json();
      const current = data.current || {};
      const temp = Math.round(current.temperature_2m);
      const feels = Math.round(current.apparent_temperature);
      const wind = Math.round(current.wind_speed_10m);
      const desc = weatherCodeToText(current.weather_code);
      const isNight = Number(current.is_day) === 0;
      if (weatherLoc) weatherLoc.textContent = '';
      weatherBody.innerHTML = '';
      const wrapper = document.createElement('div'); wrapper.className = 'weather-flex';
      const main = document.createElement('div'); main.className = 'weather-main';
      const iconBox = document.createElement('div'); iconBox.className = 'weather-icon';
      const iconImg = document.createElement('img'); iconImg.alt = desc || 'weather';
      applyIcon(iconImg, chooseWeatherIconName(current.weather_code, isNight), 'frontend/media/none.png');
      iconBox.appendChild(iconImg);
      const tempEl = document.createElement('div'); tempEl.className = 'weather-temp'; tempEl.textContent = `${temp}°${s.tempImperial ? 'F' : 'C'}`;
      const descEl = document.createElement('div'); descEl.className = 'weather-desc'; descEl.textContent = desc;
      main.appendChild(iconBox); main.appendChild(tempEl); main.appendChild(descEl);

      const meta = document.createElement('div'); meta.className = 'weather-meta';
      const feelsItem = document.createElement('div'); feelsItem.className = 'weather-chip';
      const therm = document.createElement('img'); therm.alt = ''; therm.className = 'chip-icon'; applyIcon(therm, 'thermometer', 'frontend/media/none.png');
      const feelsText = document.createElement('span'); feelsText.textContent = `Feels ${feels}°`;
      feelsItem.appendChild(therm); feelsItem.appendChild(feelsText);
      const windItem = document.createElement('div'); windItem.className = 'weather-chip';
      const windI = document.createElement('img'); windI.alt = ''; windI.className = 'chip-icon'; applyIcon(windI, 'wind', 'frontend/media/none.png');
      const windText = document.createElement('span'); windText.textContent = `${wind} ${s.windImperial ? 'mph' : 'km/h'}`;
      windItem.appendChild(windI); windItem.appendChild(windText);
      meta.appendChild(feelsItem); meta.appendChild(windItem);

      wrapper.appendChild(main); wrapper.appendChild(meta); weatherBody.appendChild(wrapper);
    } catch (e) { weatherBody.textContent = 'Weather unavailable'; }
  }

  function weatherCodeToText(code) {
    const map = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Depositing rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Dense freezing drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Heavy freezing rain', 71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Heavy rain showers', 82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail' };
    return map[code] || '';
  }
  function chooseWeatherIconName(code, isNight) {
    if (code === 0) return isNight ? 'moon' : 'sun';
    if (code === 1) return isNight ? 'moon-star' : 'sun';
    if (code === 2) return 'cloud-sun';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || code === 80 || code === 81 || code === 82) return 'cloud-rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloud-snow';
    if (code >= 95) return 'cloud-lightning';
    return 'cloud';
  }

  async function loadTodoist() {
    if (!todoList) return;
    todoList.innerHTML = '';
    const s = getSettings();
    if (!s.todoist || !s.todoist.token) {
      if (todoProj) todoProj.textContent = 'Configure in settings';
      return;
    }
    const { token } = s.todoist;
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const res = await fetch('https://api.todoist.com/rest/v2/tasks', { headers });
      if (!res.ok) throw new Error('todoist fetch failed');
      const tasks = await res.json();

      // Sort by due date ascending; undated last
      const toTs = (t) => {
        if (!t?.due?.date) return Infinity;
        // Todoist date may be YYYY-MM-DD or ISO; Date can handle both
        const d = new Date(t.due.date);
        return d.getTime();
      };
      tasks.sort((a, b) => toTs(a) - toTs(b));

      const remaining = tasks.length;
      if (todoProj) todoProj.textContent = `${remaining} task${remaining === 1 ? '' : 's'}`;

      const top = tasks.slice(0, 12);
      for (const t of top) {
        const li = document.createElement('li');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.ariaLabel = 'Mark task complete';
        checkbox.addEventListener('change', async () => {
          checkbox.disabled = true;
          const ok = await markTodoistTaskDone(token, t.id);
          if (ok) {
            li.remove();
            const newCount = Math.max(0, (parseInt((todoProj?.textContent || '0').replace(/[^0-9]/g, '') || '0', 10) - 1));
            if (todoProj) todoProj.textContent = `${newCount} task${newCount === 1 ? '' : 's'}`;
          } else {
            checkbox.checked = false;
            checkbox.disabled = false;
          }
        });
        const title = document.createElement('span');
        title.textContent = t.content || '(Untitled)';
        const due = document.createElement('span');
        due.className = 'todo-due';
        due.textContent = formatDueLabel(t.due?.date);
        li.appendChild(checkbox);
        li.appendChild(title);
        li.appendChild(due);
        todoList.appendChild(li);
      }
      if (top.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No tasks';
        todoList.appendChild(li);
      }
    } catch (e) {
      const li = document.createElement('li');
      li.textContent = 'Tasks unavailable';
      todoList.appendChild(li);
    }
  }

  function formatDueLabel(dueIso) {
    if (!dueIso) return 'No date';
    try {
      const due = new Date(dueIso);
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      const msPerDay = 24 * 60 * 60 * 1000;
      const diffDays = Math.round((startOfDue - startOfToday) / msPerDay);
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Tomorrow';
      if (diffDays < 0) return 'Overdue';
      return due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch { return 'No date'; }
  }

  async function markTodoistTaskDone(token, taskId) {
    try {
      const res = await fetch(`https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(taskId)}/close`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      return res.ok;
    } catch { return false; }
  }

  // Settings form
  function populateForm() {
    const s = getSettings();
    const $ = (id) => document.getElementById(id);
    (s.clock12h ? $('#clock-12') : $('#clock-24')).checked = true;
    $('#todoist-token').value = s.todoist?.token || '';
    $('#weather-lat').value = s.weather?.lat ?? '';
    $('#weather-lon').value = s.weather?.lon ?? '';
    (s.tempImperial ? $('#temp-f') : $('#temp-c')).checked = true;
    (s.windImperial ? $('#wind-mph') : $('#wind-kmh')).checked = true;
    renderCategoriesEditor(s.categories || []);
  }

  function renderCategoriesEditor(categories) {
    if (!editor) return;
    editor.innerHTML = '';
    categories.forEach((cat, idx) => editor.appendChild(makeCategoryRow(cat, idx)));
  }

  function buildLucideUrl(name) { return `https://cdn.jsdelivr.net/npm/lucide-static/icons/${encodeURIComponent(name)}.svg`; }
  function buildSimpleIconUrl(name) { return `https://cdn.simpleicons.org/${encodeURIComponent(name)}`; }
  function applyIcon(imgEl, name, defaultUrl) {
    const trimmed = (name || '').trim();
    if (!trimmed) { imgEl.src = defaultUrl; imgEl.onerror = null; return; }
    imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = buildSimpleIconUrl(trimmed.toLowerCase()); };
    imgEl.src = buildLucideUrl(trimmed.toLowerCase());
  }

  function makeCategoryRow(cat, idx) {
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.dataset.index = String(idx);
    row.innerHTML = `
      <div class="cat-head">
        <label>Title <input type="text" class="cat-title" value="${escapeHtml(cat.title || '')}"></label>
        <div class="icon-box">
          <label>Icon <input type="text" class="cat-icon" placeholder="Icon Name" value="${escapeHtml(cat.icon || '')}"></label>
          <img class="icon-preview" alt="icon" />
        </div>
        <div class="row-actions">
          <button type="button" class="small add-bm">+ Bookmark</button>
          <button type="button" class="small del-cat">Delete</button>
        </div>
      </div>
      <div class="bookmarks"></div>
    `;
    const list = row.querySelector('.bookmarks');
    (cat.links || []).forEach((bm) => list.appendChild(makeBmRow(bm)));
    row.querySelector('.add-bm').addEventListener('click', () => {
      if (list.children.length >= 4) return;
      list.appendChild(makeBmRow({ title: '', url: '', icon: '' }));
    });
    row.querySelector('.del-cat').addEventListener('click', () => row.remove());

    const iconInput = row.querySelector('.cat-icon');
    const preview = row.querySelector('.icon-preview');
    applyIcon(preview, cat.icon, 'frontend/media/news.png');
    iconInput.addEventListener('input', () => { applyIcon(preview, iconInput.value.trim(), 'frontend/media/news.png'); });
    return row;
  }

  function makeBmRow(bm) {
    const r = document.createElement('div');
    r.className = 'bm-row';
    r.innerHTML = `
      <input type="text" class="bm-title" placeholder="Title" value="${escapeHtml(bm.title || '')}">
      <input type="text" class="bm-url" placeholder="https://" value="${escapeHtml(bm.url || '')}">
      <input type="text" class="bm-icon" placeholder="Icon name (Lucide or Brand)" value="${escapeHtml(bm.icon || '')}" style="grid-column: span 2;">
      <div class="row-actions" style="grid-column: span 2;">
        <button type="button" class="small del-bm">Delete</button>
      </div>
      <img class="bm-preview" alt="icon" style="width:16px;height:16px;margin-left:4px;"/>
    `;
    const iconInput = r.querySelector('.bm-icon');
    const preview = r.querySelector('.bm-preview');
    applyIcon(preview, bm.icon, 'frontend/media/none.png');
    iconInput.addEventListener('input', () => { applyIcon(preview, iconInput.value.trim(), 'frontend/media/none.png'); });
    r.querySelector('.del-bm').addEventListener('click', () => r.remove());
    return r;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  document.getElementById('add-category')?.addEventListener('click', () => {
    editor.appendChild(makeCategoryRow({ title: '', icon: '', links: [] }, editor.children.length));
  });

  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = getSettings();
    const next = {
      ...s,
      clock12h: document.querySelector('input[name="clock-format"]:checked')?.value === '12',
      todoist: { token: document.getElementById('todoist-token').value.trim() },
      weather: {
        lat: parseFloat(document.getElementById('weather-lat').value),
        lon: parseFloat(document.getElementById('weather-lon').value)
      },
      tempImperial: document.querySelector('input[name="temp-units"]:checked')?.value === 'f',
      windImperial: document.querySelector('input[name="wind-units"]:checked')?.value === 'mph',
      categories: collectCategoriesFromEditor()
    };

    saveSettings(next);
    window.getSettings = () => next;

    closeOverlay();
    updateClock();
    loadTodoist();
    loadWeather();
    renderCategoriesFromSettings();
  });

  function collectCategoriesFromEditor() {
    const out = [];
    editor.querySelectorAll('.cat-row').forEach((row) => {
      const title = row.querySelector('.cat-title').value.trim();
      const links = [];
      row.querySelectorAll('.bm-row').forEach((r) => {
        const bm = {
          title: r.querySelector('.bm-title').value.trim(),
          url: r.querySelector('.bm-url').value.trim(),
          icon: r.querySelector('.bm-icon').value.trim()
        };
        if (bm.title || bm.url) links.push(bm);
      });
      const icon = row.querySelector('.cat-icon')?.value.trim();
      if (title || links.length) out.push({ title, icon, links });
    });
    return out;
  }

  // Render categories from settings; if none, seed defaults AND persist so settings show them next time
  function renderCategoriesFromSettings() {
    const s = getSettings();
    let categories = Array.isArray(s.categories) ? s.categories : [];
    const scroller = document.querySelector('.categories');
    if (!scroller) return;
    scroller.innerHTML = '';
    scroller.classList.remove('empty-state');

    if (categories.length === 0) {
      categories = getDefaultCategories();
      const seeded = { ...s, categories };
      localStorage.setItem('sp.settings', JSON.stringify(seeded));
    }

    for (const cat of categories) {
      const card = document.createElement('div');
      card.className = 'category';
      card.innerHTML = `
        <div class="category-header">
          <img class="category-icon" alt="icon" />
          <span class="category-title">${escapeHtml(cat.title || 'Category')}</span>
        </div>
        <ul class="category-links"></ul>
      `;
      const headerImg = card.querySelector('.category-icon');
      applyIcon(headerImg, cat.icon, 'frontend/media/news.png');
      const ul = card.querySelector('.category-links');
      (cat.links || []).forEach((bm) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = bm.url || '#';
        const img = document.createElement('img');
        img.className = 'link-icon'; img.alt = '';
        applyIcon(img, bm.icon, 'frontend/media/none.png');
        a.appendChild(img);
        a.appendChild(document.createTextNode(' ' + (bm.title ? bm.title : 'Link')));
        li.appendChild(a);
        ul.appendChild(li);
      });
      scroller.appendChild(card);
    }
  }

  function getDefaultCategories() {
    return [
      {
        title: 'Search', icon: 'search', links: [
          { title: 'Google', url: 'https://www.google.com', icon: 'google' },
          { title: 'YouTube', url: 'https://www.youtube.com', icon: 'youtube' },
          { title: 'Wikipedia', url: 'https://www.wikipedia.org', icon: 'wikipedia' },
          { title: 'Maps', url: 'https://maps.google.com', icon: 'map' }
        ]
      },
      {
        title: 'Social', icon: 'users', links: [
          { title: 'Reddit', url: 'https://www.reddit.com', icon: 'reddit' },
          { title: 'X', url: 'https://x.com', icon: 'x-twitter' },
          { title: 'LinkedIn', url: 'https://www.linkedin.com', icon: 'linkedin' },
          { title: 'Instagram', url: 'https://www.instagram.com', icon: 'instagram' }
        ]
      },
      {
        title: 'Dev', icon: 'code', links: [
          { title: 'GitHub', url: 'https://github.com', icon: 'github' },
          { title: 'Stack Overflow', url: 'https://stackoverflow.com', icon: 'stack-overflow' },
          { title: 'MDN Docs', url: 'https://developer.mozilla.org', icon: 'mdnwebdocs' },
          { title: 'NPM', url: 'https://www.npmjs.com', icon: 'npm' }
        ]
      },
      {
        title: 'Shopping', icon: 'shopping-bag', links: [
          { title: 'Amazon', url: 'https://www.amazon.com', icon: 'amazon' },
          { title: 'eBay', url: 'https://www.ebay.com', icon: 'ebay' },
          { title: 'Newegg', url: 'https://www.newegg.com', icon: 'newegg' },
          { title: 'AliExpress', url: 'https://www.aliexpress.com', icon: 'aliexpress' }
        ]
      }
    ];
  }

  // Initial loads
  loadWeather();
  loadTodoist();
  renderCategoriesFromSettings();
})();

/* Removed the old DOMContentLoaded autocomplete block to avoid conflicting behavior */
