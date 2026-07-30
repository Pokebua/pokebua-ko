(() => {
  const MAX_VISIBLE = 10;
  const socket = io();

  const activeCard =
    document.getElementById("activeCard");

  const activeContent =
    document.getElementById("activeContent");

  const queueList =
    document.getElementById("queueList");

  const queueCount =
    document.getElementById("queueCount");

  const moreCount =
    document.getElementById("moreCount");

  const alertEl =
    document.getElementById("alert");

  const alertKicker =
    document.getElementById("alertKicker");

  const alertName =
    document.getElementById("alertName");

  const alertItems =
    document.getElementById("alertItems");

  let currentId = null;
  let currentStartedAt = null;
  let activeTimerHandle = null;
  let alertHandle = null;

  let latestQueue = [];
  let queueClosingAt = null;
  let queueClosed = false;
  let closingTimerHandle = null;

  /* =======================================================
     GENERELLE HJELPEFUNKSJONER
  ======================================================= */

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
      .replace(
        /^https?:\/\/(www\.)?twitch\.tv\//i,
        ""
      )
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
    return (
      twitchName(entry) ||
      firstName(entry?.name)
    );
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

  /* =======================================================
     TIMER FOR AKTIV ORDRE
  ======================================================= */

  function formatActiveTimer(milliseconds) {
    const totalSeconds = Math.max(
      0,
      Math.floor(milliseconds / 1000)
    );

    const minutes =
      Math.floor(totalSeconds / 60);

    const seconds =
      totalSeconds % 60;

    return (
      `${String(minutes).padStart(2, "0")}:` +
      `${String(seconds).padStart(2, "0")}`
    );
  }

  function renderActiveTimer() {
    const timer =
      document.getElementById("activeTimer");

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

    currentStartedAt =
      Number.isFinite(parsed)
        ? parsed
        : Date.now();

    renderActiveTimer();

    activeTimerHandle = setInterval(
      renderActiveTimer,
      1000
    );
  }

  /* =======================================================
     AKTIV ORDRE
  ======================================================= */

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
    const nextId =
      entry?.id ?? null;

    const changed =
      nextId !== currentId;

    currentId = nextId;

    if (changed) {
      activeContent.classList.remove(
        "swap-in"
      );

      activeContent.classList.add(
        "swap-out"
      );
    }

    setTimeout(() => {
      const state =
        stateClass(entry);

      activeCard.className =
        `active-card ${state}`;

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

      activeContent.classList.remove(
        "swap-out"
      );

      if (changed) {
        void activeContent.offsetWidth;

        activeContent.classList.add(
          "swap-in"
        );
      }
    }, changed ? 170 : 0);
  }

  /* =======================================================
     KØSTENGING
  ======================================================= */

  function formatClosingCountdown(milliseconds) {
    const totalSeconds = Math.max(
      0,
      Math.ceil(milliseconds / 1000)
    );

    const hours =
      Math.floor(totalSeconds / 3600);

    const minutes =
      Math.floor(
        (totalSeconds % 3600) / 60
      );

    const seconds =
      totalSeconds % 60;

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

    if (!queueClosingAt) {
      return "";
    }

    const closingTimestamp =
      new Date(queueClosingAt).getTime();

    if (!Number.isFinite(closingTimestamp)) {
      return "";
    }

    const remaining =
      closingTimestamp - Date.now();

    if (remaining <= 0) {
      return `
        <div class="queue-item queue-status-card queue-closing-status">
          <div class="queue-status-icon">
            ⏳
          </div>

          <div class="queue-status-content">
            <strong>KØEN STENGER NÅ</strong>

            <small>00:00</small>
          </div>
        </div>
      `;
    }

    return `
      <div class="queue-item queue-status-card queue-closing-status">
        <div class="queue-status-icon">
          ⏳
        </div>

        <div class="queue-status-content">
          <strong>KØEN STENGER OM</strong>

          <small>
            ${formatClosingCountdown(remaining)}
          </small>
        </div>
      </div>
    `;
  }

  function restartClosingTimer() {
    clearInterval(closingTimerHandle);
    closingTimerHandle = null;

    if (!queueClosingAt || queueClosed) {
      return;
    }

    closingTimerHandle = setInterval(() => {
      renderQueue(latestQueue);
    }, 1000);
  }

  /* =======================================================
     VENTEKØ
  ======================================================= */

  function renderQueue(queue = []) {
    latestQueue =
      Array.isArray(queue)
        ? queue
        : [];

    const customers =
      customerQueue(latestQueue);

    queueCount.textContent =
      customers.length;

    const visibleCustomers =
      customers.slice(0, MAX_VISIBLE);

    const customerCards =
      visibleCustomers
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

    const statusCard =
      queueClosingCard();

    if (
      !customerCards &&
      !statusCard
    ) {
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

    moreCount.hidden =
      remaining <= 0;

    moreCount.textContent =
      remaining > 0
        ? `+ ${remaining} flere i kø`
        : "";
  }

  /* =======================================================
     VARSLER
  ======================================================= */

  function showAlert(kind, payload = {}) {
    clearTimeout(alertHandle);

    alertEl.classList.remove(
      "show",
      "giveaway"
    );

    if (kind === "giveaway") {
      alertEl.classList.add(
        "giveaway"
      );
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

  /* =======================================================
     SERVERSTATE
  ======================================================= */

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

  socket.on(
    "queue:update",
    data => {
      applyState(data);
    }
  );

  socket.on(
    "queue:closed",
    () => {
      queueClosingAt = null;
      queueClosed = true;

      restartClosingTimer();
      renderQueue(latestQueue);
    }
  );

  socket.on(
    "order:alert",
    payload => {
      showAlert(
        "order",
        payload
      );
    }
  );

  socket.on(
    "skip:alert",
    payload => {
      showAlert(
        "skip",
        payload
      );
    }
  );

  socket.on(
    "giveaway:alert",
    payload => {
      showAlert(
        "giveaway",
        payload
      );
    }
  );

  /* =======================================================
     OPPSTART
  ======================================================= */

  fetch("/api/queue")
    .then(response => {
      if (!response.ok) {
        throw new Error(
          "Kunne ikke hente kø"
        );
      }

      return response.json();
    })
    .then(data => {
      applyState(data);
    })
    .catch(() => {
      queueClosingAt = null;
      queueClosed = false;

      renderCurrent(null);
      renderQueue([]);
    });
})();
