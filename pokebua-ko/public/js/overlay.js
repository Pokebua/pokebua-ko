(() => {
  const MAX_VISIBLE = 10;
  const socket = io();

  const activeCard = document.getElementById("activeCard");
  const activeContent = document.getElementById("activeContent");
  const queueList = document.getElementById("queueList");
  const queueCount = document.getElementById("queueCount");
  const moreCount = document.getElementById("moreCount");

  const alertEl = document.getElementById("alert");
  const alertKicker = document.getElementById("alertKicker");
  const alertName = document.getElementById("alertName");
  const alertItems = document.getElementById("alertItems");

  let currentId = null;
  let currentStartedAt = null;
  let timerHandle = null;
  let alertHandle = null;

  function clean(value){
    return String(value ?? "").trim();
  }

  function twitchName(entry){
    const raw = clean(
      entry?.twitchName ||
      entry?.twitch ||
      entry?.twitch_username ||
      entry?.displayName
    );

    if(!raw) return "";

    return raw
      .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
      .replace(/^twitch\.tv\//i, "")
      .replace(/^@+/, "")
      .split(/[/?#]/)[0]
      .trim();
  }

  function firstName(value){
    const name = clean(value);
    if(!name) return "Kunde";
    return name.split(/\s+/)[0];
  }

  function displayName(entry){
    return twitchName(entry) || firstName(entry?.name);
  }

  function safeItems(value){
    if(Array.isArray(value)){
      return value.map(item => {
        if(typeof item === "string") return item;
        const title = clean(item?.title || item?.name || item?.product);
        const quantity = Number(item?.quantity || item?.qty || 1);
        return quantity > 1 ? `${title} × ${quantity}` : title;
      }).filter(Boolean);
    }

    const text = clean(value);
    if(!text) return ["Produkter ikke oppgitt"];

    return text
      .split(/\n|,\s*(?=[A-ZÆØÅ0-9])/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  function escapeHtml(value){
    return String(value)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function highlightQuantity(text){
    const escaped = escapeHtml(text);
    return escaped.replace(/(?:×|x)\s*(\d+)/gi,'<span class="qty">× $1</span>');
  }

  function formatTimer(ms){
    const total = Math.max(0,Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
  }

  function renderTimer(){
    const timer = document.getElementById("activeTimer");
    if(!timer || !currentStartedAt) return;
    timer.textContent = formatTimer(Date.now() - currentStartedAt);
  }

  function restartTimer(entry){
    clearInterval(timerHandle);

    if(!entry){
      currentStartedAt = null;
      return;
    }

    const parsed = Date.parse(entry.startedAt || entry.openedAt || "");
    currentStartedAt = Number.isFinite(parsed) ? parsed : Date.now();
    renderTimer();
    timerHandle = setInterval(renderTimer,1000);
  }

  function stateClass(entry){
    if(entry?.skipTheLine || entry?.priority) return "skip";
    if(entry?.giveaway) return "giveaway";
    return "normal";
  }

  function renderCurrent(entry){
    const nextId = entry?.id ?? null;
    const changed = nextId !== currentId;
    currentId = nextId;

    if(changed){
      activeContent.classList.remove("swap-in");
      activeContent.classList.add("swap-out");
    }

    setTimeout(() => {
      const state = stateClass(entry);
      activeCard.className = `active-card ${state}`;

      if(!entry){
        activeContent.innerHTML = `<div class="empty">Venter på neste åpning…</div>`;
        restartTimer(null);
      }else{
        const badge =
          state === "skip"
            ? `<div class="badge">★ Skip the Line</div>`
            : state === "giveaway"
              ? `<div class="badge giveaway">🎁 Giveaway</div>`
              : "";

        const itemRows = safeItems(entry.items)
          .slice(0,4)
          .map(item => `
            <div class="item-row">
              <div class="item-icon">📦</div>
              <div>${highlightQuantity(item)}</div>
            </div>
          `)
          .join("");

        activeContent.innerHTML = `
          <div class="active-header">
            <div class="person-icon">👤</div>
            <div class="active-name">${escapeHtml(displayName(entry))}</div>
          </div>

          <div class="active-divider"></div>

          <div class="items">${itemRows}</div>

${badge}

        restartTimer(entry);
      }

      activeContent.classList.remove("swap-out");

      if(changed){
        void activeContent.offsetWidth;
        activeContent.classList.add("swap-in");
      }
    },changed ? 170 : 0);
  }

  function renderQueue(queue = []){
    queueCount.textContent = queue.length;

    if(!queue.length){
      queueList.innerHTML = `<div class="empty">Køen er tom.</div>`;
      moreCount.hidden = true;
      return;
    }

    const visible = queue.slice(0,MAX_VISIBLE);

    queueList.innerHTML = visible.map((entry,index) => {
      const priority = entry?.skipTheLine || entry?.priority;
      const giveaway = entry?.giveaway;
      const cls = priority ? "priority" : giveaway ? "giveaway" : "";
      const icon = priority ? "★" : giveaway ? "🎁" : "";

      return `
        <div class="queue-item ${cls}" style="animation-delay:${index * 35}ms">
          <div class="position">${index + 1}.</div>
          <div class="q-name">${escapeHtml(displayName(entry))}</div>
          <div class="q-icon">${icon}</div>
        </div>
      `;
    }).join("");

    const remaining = queue.length - visible.length;
    moreCount.hidden = remaining <= 0;
    moreCount.textContent = remaining > 0 ? `+ ${remaining} flere i kø` : "";
  }

  function showAlert(kind,payload = {}){
    clearTimeout(alertHandle);

    alertEl.classList.remove("show","giveaway");
    if(kind === "giveaway") alertEl.classList.add("giveaway");

    alertKicker.textContent =
      kind === "skip" ? "Skip the Line" :
      kind === "giveaway" ? "Giveaway" :
      "Ny ordre";

    alertName.textContent = displayName(payload);
    alertItems.textContent = safeItems(payload.items).join(" • ");

    void alertEl.offsetWidth;
    alertEl.classList.add("show");

    alertHandle = setTimeout(() => {
      alertEl.classList.remove("show");
    },3600);
  }

  socket.on("queue:update",({current,queue}) => {
    renderCurrent(current);
    renderQueue(Array.isArray(queue) ? queue : []);
  });

  socket.on("order:alert",payload => showAlert("order",payload));
  socket.on("skip:alert",payload => showAlert("skip",payload));
  socket.on("giveaway:alert",payload => showAlert("giveaway",payload));

  fetch("/api/queue")
    .then(response => {
      if(!response.ok) throw new Error("Kunne ikke hente kø");
      return response.json();
    })
    .then(data => {
      renderCurrent(data.current);
      renderQueue(Array.isArray(data.queue) ? data.queue : []);
    })
    .catch(() => {
      renderCurrent(null);
      renderQueue([]);
    });
})();
