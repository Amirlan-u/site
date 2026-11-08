const playerIcons = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5 19 12 8 18.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H3V3M3.8 8A9 9 0 1 1 3 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.3" text-anchor="middle" fill="currentColor" font-size="7" font-weight="700">10</text></svg>',
  forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 8h5V3m-.8 5A9 9 0 1 0 21 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.3" text-anchor="middle" fill="currentColor" font-size="7" font-weight="700">10</text></svg>'
};

function renderCustomWatch(anime, route) {
  if (!anime) { location.hash = '#/'; return; }
  const old = progress(anime.id);
  let season = anime.seasons.find(s => s.number === route.season) || anime.seasons.find(s => s.number === old?.season) || anime.seasons[0];
  let episode = season.episodes.find(e => e.number === route.episode) || season.episodes.find(e => e.number === old?.episode) || season.episodes[0];
  let dub = episode.dubs.find(d => d.name === old?.dub && old.season === season.number && old.episode === episode.number) || episode.dubs[0];
  app.innerHTML = `<section class="shell watch">
    <a class="back" href="${titleUrl(anime.id)}">← &nbsp;${esc(anime.title)}</a>
    <div class="watch-heading"><div><span class="section-kicker">ЛОКАЛЬНЫЙ ПРОСМОТР</span><h1>${esc(anime.title)}</h1><p>Сезон ${season.number} <span>•</span> Серия ${episode.number} <span>•</span> ${esc(episode.title)}</p></div></div>
    <div class="cinema" id="cinema" tabindex="0" aria-label="Видеоплеер">
      <video id="video" playsinline preload="metadata"></video>
      <div class="cinema-shade" id="cinemaShade"></div>
      <div class="cinema-top"><span class="cinema-brand">◈ ANIMESHELF</span><span>Сезон ${season.number} · Серия ${episode.number}</span></div>
      <div class="pause-card" id="pauseCard">
        <span class="pause-eyebrow">СЕЙЧАС ВЫ СМОТРИТЕ</span>
        <h2>${esc(anime.title)}</h2>
        <p>${esc(episode.title)}</p>
        <div class="pause-details"><span>СЕЗОН <strong>${season.number}</strong></span><span>СЕРИЯ <strong>${episode.number}</strong></span><span>ОЗВУЧКА <strong id="pauseDub">${esc(dub.name)}</strong></span></div>
        <button type="button" id="centerPlay" aria-label="Продолжить воспроизведение">${playerIcons.play} Продолжить просмотр</button>
      </div>
      <div class="cinema-controls" id="cinemaControls">
        <div class="cinema-selectors">
          <label>Сезон<select id="seasonSelect">${anime.seasons.map(s => `<option value="${s.number}">Сезон ${s.number}</option>`).join('')}</select></label>
          <label>Серия<select id="episodeSelect"></select></label>
          <label>Озвучка<select id="dubSelect"></select></label>
        </div>
        <div class="timeline-row"><input id="seek" type="range" min="0" max="1000" value="0" aria-label="Перемотка"><span id="clock">0:00 / 0:00</span></div>
        <div class="control-row"><button type="button" id="playPause" aria-label="Воспроизвести">${playerIcons.play}</button><button type="button" id="skipBack" aria-label="Назад на 10 секунд">${playerIcons.back}</button><button type="button" id="skipForward" aria-label="Вперёд на 10 секунд">${playerIcons.forward}</button><span class="control-spacer"></span><label class="volume-control" aria-label="Громкость">♫ <input id="volume" type="range" min="0" max="1" step="0.05" value="1"></label><button type="button" id="fullscreen" aria-label="На весь экран">⛶</button></div>
      </div>
      <div class="video-error" id="videoError" hidden>Не удалось воспроизвести файл. Проверьте формат видео.</div>
    </div>
    <div class="below-player"><span id="saveStatus">Таймкод сохранится автоматически</span><button type="button" id="nextButton">Следующая серия →</button></div>
  </section>`;

  const frame = document.getElementById('cinema');
  const video = document.getElementById('video');
  const seasonSelect = document.getElementById('seasonSelect');
  const episodeSelect = document.getElementById('episodeSelect');
  const dubSelect = document.getElementById('dubSelect');
  const seek = document.getElementById('seek');
  const clock = document.getElementById('clock');
  const playPause = document.getElementById('playPause');
  const centerPlay = document.getElementById('centerPlay');
  let hideTimer;
  let lastSaved = 0;
  let restoreAt = 0;
  let resumeAfterLoad = false;

  const persist = () => {
    if (video.readyState === 0) return;
    save(anime.id, { season: season.number, episode: episode.number, dub: dub.name, time: video.currentTime || 0 });
    document.getElementById('saveStatus').textContent = `Сохранено: сезон ${season.number}, серия ${episode.number}, ${dub.name}, ${time(video.currentTime)}`;
  };
  activeVideo = { save: persist };

  const updateTimeline = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    seek.value = duration ? String(Math.round(video.currentTime / duration * 1000)) : '0';
    seek.style.setProperty('--played', `${Number(seek.value) / 10}%`);
    clock.textContent = `${time(video.currentTime)} / ${time(duration)}`;
  };
  const showControls = () => {
    frame.classList.remove('controls-hidden');
    clearTimeout(hideTimer);
    if (!video.paused) hideTimer = setTimeout(() => {
      if (!frame.contains(document.activeElement) || document.activeElement === frame) frame.classList.add('controls-hidden');
    }, 2500);
  };
  const syncState = () => {
    const paused = video.paused || video.ended;
    frame.classList.toggle('is-paused', paused);
    playPause.innerHTML = paused ? playerIcons.play : playerIcons.pause;
    playPause.setAttribute('aria-label', paused ? 'Воспроизвести' : 'Пауза');
    showControls();
  };
  const togglePlayback = () => {
    if (video.paused) video.play().catch(() => showControls());
    else video.pause();
  };
  const fillSelectors = () => {
    seasonSelect.value = String(season.number);
    episodeSelect.innerHTML = season.episodes.map(e => `<option value="${e.number}">${e.number}. ${esc(e.title)}</option>`).join('');
    episodeSelect.value = String(episode.number);
    dubSelect.innerHTML = episode.dubs.map((d, index) => `<option value="${index}">${esc(d.name)}</option>`).join('');
    dubSelect.value = String(episode.dubs.indexOf(dub));
  };
  fillSelectors();
  const loadVideo = () => { video.src = dub.src; video.load(); document.getElementById('pauseDub').textContent = dub.name; };
  loadVideo();

  video.addEventListener('loadedmetadata', () => {
    const p = progress(anime.id);
    const position = restoreAt || (p?.season === season.number && p?.episode === episode.number && p?.dub === dub.name ? p.time : 0);
    if (position > 0 && position < video.duration - 1) video.currentTime = position;
    restoreAt = 0;
    updateTimeline();
    persist();
    if (resumeAfterLoad) { resumeAfterLoad = false; video.play().catch(() => showControls()); }
  });
  video.addEventListener('timeupdate', () => {
    updateTimeline();
    if (Date.now() - lastSaved > 1000) { persist(); lastSaved = Date.now(); }
  });
  video.addEventListener('durationchange', updateTimeline);
  video.addEventListener('play', syncState);
  video.addEventListener('pause', () => { syncState(); persist(); });
  video.addEventListener('ended', () => { syncState(); persist(); });
  video.addEventListener('seeked', persist);
  video.addEventListener('error', () => { document.getElementById('videoError').hidden = false; showControls(); });

  playPause.onclick = togglePlayback;
  centerPlay.onclick = togglePlayback;
  video.onclick = togglePlayback;
  frame.addEventListener('mousemove', showControls);
  frame.addEventListener('touchstart', showControls, { passive: true });
  frame.addEventListener('mouseleave', () => { if (!video.paused) { clearTimeout(hideTimer); hideTimer = setTimeout(() => frame.classList.add('controls-hidden'), 1300); } });
  frame.addEventListener('keydown', event => {
    if (['SELECT', 'INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) return;
    if (event.code === 'Space' || event.code === 'KeyK') { event.preventDefault(); togglePlayback(); }
    if (event.code === 'ArrowLeft') { event.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 10); }
    if (event.code === 'ArrowRight') { event.preventDefault(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); }
  });
  seek.oninput = () => { if (Number.isFinite(video.duration)) video.currentTime = Number(seek.value) / 1000 * video.duration; updateTimeline(); };
  document.getElementById('skipBack').onclick = () => video.currentTime = Math.max(0, video.currentTime - 10);
  document.getElementById('skipForward').onclick = () => video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
  document.getElementById('volume').oninput = event => video.volume = Number(event.target.value);
  document.getElementById('fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (frame.requestFullscreen) frame.requestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  };
  seasonSelect.onchange = () => {
    const next = anime.seasons.find(s => s.number === Number(seasonSelect.value));
    location.hash = url(anime.id, next.number, next.episodes[0].number);
  };
  episodeSelect.onchange = () => location.hash = url(anime.id, season.number, episodeSelect.value);
  dubSelect.onchange = () => {
    const position = video.currentTime || 0;
    resumeAfterLoad = !video.paused;
    dub = episode.dubs[Number(dubSelect.value)];
    restoreAt = position;
    save(anime.id, { season: season.number, episode: episode.number, dub: dub.name, time: position });
    loadVideo();
    syncState();
  };
  document.getElementById('nextButton').onclick = () => {
    const index = season.episodes.findIndex(e => e.number === episode.number);
    if (index + 1 < season.episodes.length) location.hash = url(anime.id, season.number, season.episodes[index + 1].number);
    else {
      const nextSeason = anime.seasons[anime.seasons.indexOf(season) + 1];
      if (nextSeason) location.hash = url(anime.id, nextSeason.number, nextSeason.episodes[0].number);
    }
  };
  syncState();
}
