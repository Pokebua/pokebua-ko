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
  let activeTimerHandle = null;
  let alertHandle = null;

  let latestQueue = [];
  let queueClosingAt = null;
  let queueClosed = false;
  let closingTimerHandle = null;

  let dragonAnimationHandle = null;
  const DRAGON_ANIMATION_DURATION = 5400;

  function clean(value) {
    return String(value ?? "").trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function twitchName(entry) {
    const raw = clean(
      entry?.twitchName ||
      entry?.twitch ||
      entry?.twitch_username ||
      entry?.streamName ||
      entry?.displayName
    );

    if (!raw) {
      return "";
    }

    return raw
      .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "")
      .replace(/^twitch\.tv\//i, "")
      .replace(/^@+/, "")
      .split(/[/?#]/)[0]
      .trim();
  }

  function firstName(value) {
    const name = clean(value);

    if (!name) {
      return "Kunde";
    }

    return name.split(/\s+/)[0];
  }

  function displayName(entry) {
    return twitchName(entry) || firstName(entry?.name);
  }

  function isQueueClosedEntry(entry = {}) {
    return (
      entry.system === true &&
      entry.type === "queue-closed"
    );
  }

  function customerQueue(queue = []) {
    return queue.filter(
      entry => !isQueueClosedEntry(entry)
    );
  }

  function safeItems(value) {
    if (Array.isArray(value)) {
      return value
        .map(item => {
          if (typeof item === "string") {
            return item;
          }

          const title = clean(
            item?.title ||
            item?.name ||
            item?.product
          );

          const quantity = Number(
            item?.quantity ||
            item?.qty ||
            1
          );

          return quantity > 1
            ? `${title} × ${quantity}`
            : title;
        })
        .filter(Boolean);
    }

    const text = clean(value);

    if (!text) {
      return ["Produkter ikke oppgitt"];
    }

    return text
      .split(/\n|,\s*(?=[A-ZÆØÅ0-9])/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  function formatActiveTimer(milliseconds) {
    const totalSeconds = Math.max(
      0,
      Math.floor(milliseconds / 1000)
    );

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return (
      `${String(minutes).padStart(2, "0")}:` +
      `${String(seconds).padStart(2, "0")}`
    );
  }

  function renderActiveTimer() {
    const timer = document.getElementById("activeTimer");

    if (!timer || !currentStartedAt) {
      return;
    }

    timer.textContent = formatActiveTimer(
      Date.now() - currentStartedAt
    );
  }

  function restartActiveTimer(entry) {
    clearInterval(activeTimerHandle);
    activeTimerHandle = null;

    if (!entry) {
      currentStartedAt = null;
      return;
    }

    const parsed = Date.parse(
      entry.startedAt ||
      entry.openedAt ||
      ""
    );

    currentStartedAt = Number.isFinite(parsed)
      ? parsed
      : Date.now();

    renderActiveTimer();

    activeTimerHandle = setInterval(
      renderActiveTimer,
      1000
    );
  }

  function stateClass(entry) {
    if (
      entry?.skipTheLine ||
      entry?.priority
    ) {
      return "skip";
    }

    if (entry?.giveaway) {
      return "giveaway";
    }

    return "normal";
  }

  function renderCurrent(entry) {
    const nextId = entry?.id ?? null;
    const changed = nextId !== currentId;

    currentId = nextId;

    if (changed) {
      activeContent.classList.remove("swap-in");
      activeContent.classList.add("swap-out");
    }

    setTimeout(() => {
      const state = stateClass(entry);

      activeCard.className = `active-card ${state}`;

      if (!entry) {
        activeContent.innerHTML = `
          <div class="empty">
            Venter på neste åpning…
          </div>
        `;

        restartActiveTimer(null);
      } else {
        const badge =
          state === "skip"
            ? `
              <div class="badge">
                ★ Skip the Line
              </div>
            `
            : state === "giveaway"
              ? `
                <div class="badge giveaway">
                  🎁 Giveaway
                </div>
              `
              : "";

        const packIcon = `
          <svg
            class="svg-icon pack-svg"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M7 2h10l2 3v16H5V5l2-3Z"></path>
            <path d="M7 2l2 4h6l2-4"></path>
            <path d="M8 10h8"></path>
            <path d="M9 14h6"></path>
          </svg>
        `;

        const itemRows = safeItems(entry.items)
          .slice(0, 6)
          .map(item => {
            const match = item.match(
              /^(.*?)(?:\s*[x×]\s*(\d+))$/i
            );

            const name = match
              ? match[1].trim()
              : item;

            const quantity = match
              ? match[2]
              : "";

            return `
              <div class="item-row">
                <div class="item-icon">
                  ${packIcon}
                </div>

                <div class="item-name">
                  ${escapeHtml(name)}
                </div>

                <div class="item-qty">
                  ${
                    quantity
                      ? `×${escapeHtml(quantity)}`
                      : ""
                  }
                </div>
              </div>
            `;
          })
          .join("");

        activeContent.innerHTML = `
          <div class="active-header">
            <div class="person-icon">
              <svg
                class="svg-icon person-svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="8"
                  r="4"
                ></circle>

                <path
                  d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"
                ></path>
              </svg>
            </div>

            <div class="active-name">
              ${escapeHtml(displayName(entry))}
            </div>
          </div>

          <div class="active-divider"></div>

          <div class="items">
            ${itemRows}
          </div>

          ${badge}
        `;

        restartActiveTimer(entry);
      }

      activeContent.classList.remove("swap-out");

      if (changed) {
        void activeContent.offsetWidth;
        activeContent.classList.add("swap-in");
      }
    }, changed ? 170 : 0);
  }

  function formatClosingCountdown(milliseconds) {
    const totalSeconds = Math.max(
      0,
      Math.ceil(milliseconds / 1000)
    );

    const hours = Math.floor(totalSeconds / 3600);

    const minutes = Math.floor(
      (totalSeconds % 3600) / 60
    );

    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return (
        `${String(hours).padStart(2, "0")}:` +
        `${String(minutes).padStart(2, "0")}:` +
        `${String(seconds).padStart(2, "0")}`
      );
    }

    return (
      `${String(minutes).padStart(2, "0")}:` +
      `${String(seconds).padStart(2, "0")}`
    );
  }

  function getClosingTimestamp() {
    if (!queueClosingAt) {
      return null;
    }

    const timestamp = new Date(queueClosingAt).getTime();

    return Number.isFinite(timestamp)
      ? timestamp
      : null;
  }

  function queueClosingCard() {
    if (queueClosed) {
      return `
        <div class="queue-item queue-status-card queue-closed-status">
          <div class="queue-status-icon">
            ⛔
          </div>

          <div class="queue-status-content">
            <strong>KØ STENGT</strong>

            <small>
              Ingen flere bestillinger i kveld
            </small>
          </div>
        </div>
      `;
    }

    const closingTimestamp = getClosingTimestamp();

    if (!closingTimestamp) {
      return "";
    }

    const remaining = closingTimestamp - Date.now();

    return `
      <div class="queue-item queue-status-card queue-closing-status">
        <div class="queue-status-icon">
          ⏳
        </div>

        <div class="queue-status-content">
          <strong>KØEN STENGER OM</strong>

          <small id="queueClosingCountdown">
            ${formatClosingCountdown(remaining)}
          </small>
        </div>
      </div>
    `;
  }

  function updateClosingCountdown() {
    if (!queueClosingAt || queueClosed) {
      return;
    }

    const countdown =
      document.getElementById("queueClosingCountdown");

    if (!countdown) {
      return;
    }

    const closingTimestamp = getClosingTimestamp();

    if (!closingTimestamp) {
      return;
    }

    const remaining =
      closingTimestamp - Date.now();

    countdown.textContent =
      formatClosingCountdown(remaining);
  }

  function restartClosingTimer() {
    clearInterval(closingTimerHandle);
    closingTimerHandle = null;

    if (!queueClosingAt || queueClosed) {
      return;
    }

    updateClosingCountdown();

    closingTimerHandle = setInterval(() => {
      updateClosingCountdown();
    }, 1000);
  }

  function renderQueue(queue = []) {
    latestQueue = Array.isArray(queue)
      ? queue
      : [];

    const customers = customerQueue(latestQueue);

    queueCount.textContent = customers.length;

    const visibleCustomers =
      customers.slice(0, MAX_VISIBLE);

    const customerCards = visibleCustomers
      .map((entry, index) => {
        const skip =
          entry?.skipTheLine ||
          entry?.priority;

        const giveaway =
          entry?.giveaway;

        const isFirst =
          index === 0;

        const classes = [
          isFirst ? "priority" : "",
          skip ? "skip" : "",
          giveaway ? "giveaway" : ""
        ]
          .filter(Boolean)
          .join(" ");

        const icon = skip
          ? "★"
          : giveaway
            ? "🎁"
            : "";

        return `
          <div
            class="queue-item ${classes}"
            style="animation-delay:${index * 35}ms"
          >
            <div class="position">
              ${index + 1}.
            </div>

            <div class="q-name">
              ${escapeHtml(displayName(entry))}
            </div>

            <div class="q-icon">
              ${icon}
            </div>
          </div>
        `;
      })
      .join("");

    const statusCard = queueClosingCard();

    if (!customerCards && !statusCard) {
      queueList.innerHTML = `
        <div class="empty">
          Køen er tom.
        </div>
      `;

      moreCount.hidden = true;
      return;
    }

    queueList.innerHTML =
      customerCards + statusCard;

    const remaining =
      customers.length -
      visibleCustomers.length;

    moreCount.hidden = remaining <= 0;

    moreCount.textContent =
      remaining > 0
        ? `+ ${remaining} flere i kø`
        : "";
  }

  function showAlert(kind, payload = {}) {
    clearTimeout(alertHandle);

    alertEl.classList.remove(
      "show",
      "giveaway"
    );

    if (kind === "giveaway") {
      alertEl.classList.add("giveaway");
    }

    alertKicker.textContent =
      kind === "skip"
        ? "Skip the Line"
        : kind === "giveaway"
          ? "Giveaway"
          : "Ny ordre";

    alertName.textContent =
      displayName(payload);

    alertItems.textContent =
      safeItems(payload.items).join(" • ");

    void alertEl.offsetWidth;

    alertEl.classList.add("show");

    alertHandle = setTimeout(() => {
      alertEl.classList.remove("show");
    }, 3600);
  }

  /* ======================================================
     POKEBUA DRAGON EVENT
  ====================================================== */

  function createDragonEmbers(amount = 42) {
    return Array.from({ length: amount }, () => {
      const x = Math.round(Math.random() * 100);
      const size = Math.round(4 + Math.random() * 10);
      const duration = (2.2 + Math.random() * 2.8).toFixed(2);
      const delay = (Math.random() * 2.2).toFixed(2);
      const drift = Math.round(-160 + Math.random() * 320);

      return `
        <span
          class="dragon-ember"
          style="
            --x:${x}%;
            --size:${size}px;
            --duration:${duration}s;
            --delay:${delay}s;
            --drift:${drift}px;
          "
          aria-hidden="true"
        ></span>
      `;
    }).join("");
  }

  function buildDragonScene() {
    const dragonEvent =
      document.getElementById("dragonEvent");

    if (!dragonEvent) {
      console.error("Fant ikke #dragonEvent i overlay.html");
      return null;
    }

    if (
      dragonEvent.dataset.ready === "true" &&
      dragonEvent.querySelector(".dragon-stage")
    ) {
      return dragonEvent;
    }

    dragonEvent.innerHTML = `
      <div class="dragon-stage">
        <div class="dragon-character" aria-hidden="true">
          <div class="dragon-wing left"></div>
          <div class="dragon-wing right"></div>

          <div class="dragon-tail">
            <div class="dragon-tail-fire"></div>
          </div>

          <div class="dragon-body"></div>

          <div class="dragon-head">
  <div class="dragon-horn left"></div>
  <div class="dragon-horn right"></div>

  <div class="dragon-eye left"></div>
  <div class="dragon-eye right"></div>

  <div class="dragon-snout">
    <div class="dragon-nostril left"></div>
    <div class="dragon-nostril right"></div>
  </div>

  <div class="dragon-mouth">
    <div class="dragon-mouth-glow"></div>
    <div class="dragon-tooth tooth-1"></div>
    <div class="dragon-tooth tooth-2"></div>
    <div class="dragon-tooth tooth-3"></div>
    <div class="dragon-tooth tooth-4"></div>
  </div>
</div>

<div class="dragon-fire-breath" aria-hidden="true">
  <div class="dragon-fire-core"></div>
  <div class="dragon-fire-outer"></div>
  <div class="dragon-fire-sparks"></div>
</div>
        </div>

        <div class="dragon-sign-wrap">
          <div class="dragon-sign">
            <div class="dragon-sign-title">
              SKIP THE LINE
            </div>

            <div id="dragonName"></div>
          </div>
        </div>

        <div class="dragon-embers" aria-hidden="true">
          ${createDragonEmbers()}
        </div>

        <div
          class="dragon-shockwave"
          aria-hidden="true"
        ></div>

        <div
          class="dragon-flash"
          aria-hidden="true"
        ></div>
      </div>
    `;

    dragonEvent.dataset.ready = "true";

    return dragonEvent;
  }

  function stopDragonAnimation() {
    clearTimeout(dragonAnimationHandle);
    dragonAnimationHandle = null;

    const dragonEvent =
      document.getElementById("dragonEvent");

    if (!dragonEvent) {
      return;
    }

    dragonEvent.classList.remove("show");
    dragonEvent.setAttribute("aria-hidden", "true");
  }

  function playDragonAnimation(payload = {}) {
    const dragonEvent = buildDragonScene();

    if (!dragonEvent) {
      return;
    }

    clearTimeout(dragonAnimationHandle);

    const dragonName =
      dragonEvent.querySelector("#dragonName");

    if (dragonName) {
      dragonName.textContent = displayName(payload);
    }

    dragonEvent.classList.remove("show");
    dragonEvent.setAttribute("aria-hidden", "true");

    void dragonEvent.offsetWidth;

    dragonEvent.setAttribute("aria-hidden", "false");
    dragonEvent.classList.add("show");

    dragonAnimationHandle = setTimeout(() => {
      stopDragonAnimation();
    }, DRAGON_ANIMATION_DURATION + 150);
  }

  function applyState(data = {}) {
    queueClosingAt =
      data.queueClosingAt || null;

    queueClosed =
      data.queueClosed === true;

    renderCurrent(
      data.current || null
    );

    renderQueue(
      Array.isArray(data.queue)
        ? data.queue
        : []
    );

    restartClosingTimer();
  }

  socket.on("queue:update", data => {
    applyState(data);
  });

  socket.on("queue:closed", () => {
    queueClosingAt = null;
    queueClosed = true;

    clearInterval(closingTimerHandle);
    closingTimerHandle = null;

    renderQueue(latestQueue);
  });

  socket.on("order:alert", payload => {
    showAlert("order", payload);
  });

  socket.on("skip:alert", payload => {
  if (window.PokebuaSkipScene) {
    window.PokebuaSkipScene.play(
      displayName(payload)
    );
  }
});



  fetch("/api/queue")
    .then(response => {
      if (!response.ok) {
        throw new Error("Kunne ikke hente kø");
      }

      return response.json();
    })
    .then(data => {
      applyState(data);
    })
    .catch(error => {
      console.error("Kunne ikke hente kø:", error);

      queueClosingAt = null;
      queueClosed = false;

      renderCurrent(null);
      renderQueue([]);
    });
})();
