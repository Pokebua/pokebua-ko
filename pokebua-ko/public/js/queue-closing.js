(() => {
  const elements = {
    panel: document.getElementById("queueClosingPanel"),
    badge: document.getElementById("queueStatusBadge"),
    statusText: document.getElementById("queueStatusText"),

    idle: document.getElementById("queueClosingIdle"),
    running: document.getElementById("queueClosingRunning"),
    closed: document.getElementById("queueClosingClosed"),

    minutes: document.getElementById("queueClosingMinutes"),
    countdown: document.getElementById("queueClosingCountdown"),
    clock: document.getElementById("queueClosingClock"),

    start: document.getElementById("startQueueClosing"),
    cancel: document.getElementById("cancelQueueClosing"),
    reopen: document.getElementById("reopenQueue")
  };

  if (!elements.panel) {
    return;
  }

  let closingAt = null;
  let queueClosed = false;
  let countdownInterval = null;
  let warningShown = false;

  function showToast(title, detail = "") {
    if (typeof toast === "function") {
      toast(title, detail);
    }
  }

  function logActivity(text, icon = "◷") {
    if (typeof addActivity === "function") {
      addActivity(text, icon);
    }
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const data = response.status === 204
      ? null
      : await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || `Feil ${response.status}`);
    }

    return data;
  }

  function setVisible(element, visible) {
    if (!element) {
      return;
    }

    element.hidden = !visible;
  }

  function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(
      0,
      Math.ceil(milliseconds / 1000)
    );

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [
        String(hours).padStart(2, "0"),
        String(minutes).padStart(2, "0"),
        String(seconds).padStart(2, "0")
      ].join(":");
    }

    return [
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0")
    ].join(":");
  }

  function formatClosingClock(date) {
    return `Stenger kl. ${date.toLocaleTimeString("no-NO", {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }

  function setBadge(status) {
    elements.badge.classList.remove(
      "open",
      "closing",
      "closed"
    );

    elements.panel.classList.remove(
      "is-open",
      "is-closing",
      "is-closed"
    );

    if (status === "closed") {
      elements.badge.classList.add("closed");
      elements.panel.classList.add("is-closed");
      elements.statusText.textContent = "STENGT";
      return;
    }

    if (status === "closing") {
      elements.badge.classList.add("closing");
      elements.panel.classList.add("is-closing");
      elements.statusText.textContent = "STENGER SNART";
      return;
    }

    elements.badge.classList.add("open");
    elements.panel.classList.add("is-open");
    elements.statusText.textContent = "ÅPEN";
  }

  function renderOpen() {
    setBadge("open");

    setVisible(elements.idle, true);
    setVisible(elements.running, false);
    setVisible(elements.closed, false);

    elements.countdown.textContent = "00:00";
    elements.clock.textContent = "Ingen stenging er planlagt";
  }

  function renderClosing() {
    const closingDate = new Date(closingAt);
    const remaining = closingDate.getTime() - Date.now();

    if (!Number.isFinite(closingDate.getTime()) || remaining <= 0) {
      elements.countdown.textContent = "00:00";
      elements.clock.textContent = "Stenger nå";
      return;
    }

    setBadge("closing");

    setVisible(elements.idle, false);
    setVisible(elements.running, true);
    setVisible(elements.closed, false);

    elements.countdown.textContent = formatCountdown(remaining);
    elements.clock.textContent = formatClosingClock(closingDate);

    if (remaining <= 5 * 60 * 1000 && !warningShown) {
      warningShown = true;
      showToast(
        "Køen stenger snart",
        "Det er under fem minutter igjen."
      );
    }
  }

  function renderClosed() {
    setBadge("closed");

    setVisible(elements.idle, false);
    setVisible(elements.running, false);
    setVisible(elements.closed, true);

    elements.countdown.textContent = "00:00";
    elements.clock.textContent = "Køen er stengt";
  }

  function render() {
    if (queueClosed) {
      renderClosed();
      return;
    }

    if (closingAt) {
      renderClosing();
      return;
    }

    renderOpen();
  }

  function stopCountdownInterval() {
    if (!countdownInterval) {
      return;
    }

    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  function startCountdownInterval() {
    stopCountdownInterval();

    countdownInterval = setInterval(() => {
      if (!closingAt || queueClosed) {
        stopCountdownInterval();
        render();
        return;
      }

      const remaining =
        new Date(closingAt).getTime() - Date.now();

      if (remaining <= 0) {
        elements.countdown.textContent = "00:00";
        elements.clock.textContent = "Stenger nå";
        return;
      }

      renderClosing();
    }, 250);
  }

  function updateState(data = {}) {
    closingAt = data.queueClosingAt || null;
    queueClosed = data.queueClosed === true;

    if (!closingAt) {
      warningShown = false;
    }

    render();

    if (closingAt && !queueClosed) {
      startCountdownInterval();
    } else {
      stopCountdownInterval();
    }
  }

  async function startClosing() {
    const minutes = Number(elements.minutes.value);

    if (!Number.isFinite(minutes) || minutes <= 0) {
      showToast(
        "Ugyldig tid",
        "Skriv inn minst ett minutt."
      );

      elements.minutes.focus();
      return;
    }

    elements.start.disabled = true;

    try {
      const data = await request("/api/queue/closing", {
        method: "POST",
        body: JSON.stringify({
          minutes
        })
      });

      updateState(data);

      logActivity(
        `Køen stenger om ${minutes} minutter`,
        "⏳"
      );

      showToast(
        "Nedtelling startet",
        `Køen stenger om ${minutes} minutter.`
      );
    } catch (error) {
      showToast(
        "Kunne ikke starte nedtelling",
        error.message
      );
    } finally {
      elements.start.disabled = false;
    }
  }

  async function openQueueAgain() {
    elements.cancel.disabled = true;
    elements.reopen.disabled = true;

    try {
      const data = await request("/api/queue/closing", {
        method: "DELETE"
      });

      updateState(data);

      logActivity("Køen ble åpnet igjen", "🟢");
      showToast("Køen er åpen igjen");
    } catch (error) {
      showToast(
        "Kunne ikke åpne køen",
        error.message
      );
    } finally {
      elements.cancel.disabled = false;
      elements.reopen.disabled = false;
    }
  }

  elements.start.addEventListener("click", startClosing);
  elements.cancel.addEventListener("click", openQueueAgain);
  elements.reopen.addEventListener("click", openQueueAgain);

  elements.minutes.addEventListener("keydown", event => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    startClosing();
  });

  socket.on("queue:update", updateState);

  socket.on("queue:closed", () => {
    queueClosed = true;
    closingAt = null;

    render();
    stopCountdownInterval();

    logActivity("Køen ble automatisk stengt", "⛔");
    showToast(
      "Køen er stengt",
      "KØ STENGT er lagt nederst i køen."
    );
  });

  fetch("/api/queue")
    .then(response => {
      if (!response.ok) {
        throw new Error(`Feil ${response.status}`);
      }

      return response.json();
    })
    .then(updateState)
    .catch(error => {
      showToast(
        "Kunne ikke hente køstatus",
        error.message
      );
    });

  renderOpen();
})();
