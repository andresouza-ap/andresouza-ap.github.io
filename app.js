(function () {
  "use strict";

  const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
  const MONTH_LABELS = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  const start = parseISODate(CONFIG.SESSION_START);
  const end = parseISODate(CONFIG.SESSION_END);

  const state = {
    viewYear: start.getFullYear(),
    viewMonth: start.getMonth(), // 0-based
    availableDays: new Set(),    // "YYYY-MM-DD" strings with open slots, for the visible month
    selectedDate: null,          // "YYYY-MM-DD"
    selectedTime: null,          // "HH:mm"
    loadingDays: false,
  };

  const el = {
    monthLabel: document.getElementById("monthLabel"),
    weekdays: document.getElementById("weekdays"),
    grid: document.getElementById("calendarGrid"),
    prevBtn: document.getElementById("prevMonth"),
    nextBtn: document.getElementById("nextMonth"),
    slotsHint: document.getElementById("slotsHint"),
    slotsGrid: document.getElementById("slotsGrid"),
    form: document.getElementById("bookingForm"),
    summary: document.getElementById("selectionSummary"),
    status: document.getElementById("formStatus"),
    confirmBtn: document.getElementById("confirmBtn"),
    whatsappLink: document.getElementById("whatsappLink"),
  };

  init();

  function init() {
    WEEKDAY_LABELS.forEach((d) => {
      const span = document.createElement("span");
      span.textContent = d;
      el.weekdays.appendChild(span);
    });

    el.prevBtn.addEventListener("click", () => changeMonth(-1));
    el.nextBtn.addEventListener("click", () => changeMonth(1));
    el.form.addEventListener("submit", handleSubmit);

    renderCalendarShell();
    loadAvailableDays();
  }

  function changeMonth(delta) {
    const next = new Date(state.viewYear, state.viewMonth + delta, 1);
    // Don't navigate outside the booking window's months.
    if (next < new Date(start.getFullYear(), start.getMonth(), 1)) return;
    if (next > new Date(end.getFullYear(), end.getMonth(), 1)) return;
    state.viewYear = next.getFullYear();
    state.viewMonth = next.getMonth();
    state.availableDays.clear();
    renderCalendarShell();
    loadAvailableDays();
  }

  function renderCalendarShell() {
    el.monthLabel.textContent = `${MONTH_LABELS[state.viewMonth]} ${state.viewYear}`;
    el.prevBtn.disabled = state.viewYear === start.getFullYear() && state.viewMonth === start.getMonth();
    el.nextBtn.disabled = state.viewYear === end.getFullYear() && state.viewMonth === end.getMonth();
    drawGrid();
  }

  function drawGrid() {
    el.grid.innerHTML = "";
    const firstOfMonth = new Date(state.viewYear, state.viewMonth, 1);
    const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
    const leadingBlanks = firstOfMonth.getDay();
    const today = stripTime(new Date());

    for (let i = 0; i < leadingBlanks; i++) {
      el.grid.appendChild(makeDayCell(null));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(state.viewYear, state.viewMonth, day);
      const iso = toISODate(date);
      const cell = makeDayCell(day);

      const inWindow = date >= start && date <= end;
      const isPast = date < today;

      if (!inWindow || isPast) {
        cell.classList.add("past");
      } else if (state.availableDays.has(iso)) {
        cell.classList.add("available");
        cell.addEventListener("click", () => selectDate(iso, cell));
      }
      if (state.selectedDate === iso) cell.classList.add("selected");

      el.grid.appendChild(cell);
    }
  }

  function makeDayCell(day) {
    const div = document.createElement("div");
    if (day === null) {
      div.className = "day empty";
    } else {
      div.className = "day";
      div.textContent = String(day);
    }
    return div;
  }

  async function loadAvailableDays() {
    state.loadingDays = true;
    const monthStr = `${state.viewYear}-${pad(state.viewMonth + 1)}`;
    try {
      const data = await apiGet({ action: "days", month: monthStr });
      state.availableDays = new Set(data.days || []);
    } catch (err) {
      console.error("Falha ao carregar dias disponíveis:", err);
    } finally {
      state.loadingDays = false;
      drawGrid();
    }
  }

  /**
   * Recarrega só a lista de horários do dia selecionado (para remover o
   * horário que acabou de ser reservado), sem esconder o formulário nem
   * o botão do WhatsApp — diferente de selectDate(), que é usada quando
   * o cliente troca de dia manualmente.
   */
  async function refreshSlotsForSelectedDate() {
    if (!state.selectedDate) return;
    try {
      const data = await apiGet({ action: "slots", date: state.selectedDate });
      renderSlots(data.slots || []);
    } catch (err) {
      console.error(err);
    }
  }

  async function selectDate(iso, cellEl) {
    state.selectedDate = iso;
    state.selectedTime = null;
    document.querySelectorAll(".day.selected").forEach((c) => c.classList.remove("selected"));
    cellEl.classList.add("selected");

    el.form.classList.add("hidden");
    el.whatsappLink.classList.add("hidden");
    el.slotsGrid.innerHTML = "";
    el.slotsHint.textContent = "Carregando horários…";

    try {
      const data = await apiGet({ action: "slots", date: iso });
      renderSlots(data.slots || []);
    } catch (err) {
      el.slotsHint.textContent = "Não foi possível carregar os horários. Tente novamente.";
      console.error(err);
    }
  }

  function renderSlots(slots) {
    el.slotsGrid.innerHTML = "";
    if (!slots.length) {
      el.slotsHint.textContent = "Não há horários livres neste dia. Escolha outra data.";
      return;
    }
    el.slotsHint.textContent = `Horários livres em ${formatDatePretty(state.selectedDate)}:`;

    slots.forEach((time) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";
      btn.textContent = time;
      btn.addEventListener("click", () => selectTime(time, btn));
      el.slotsGrid.appendChild(btn);
    });
  }

  function selectTime(time, btnEl) {
    state.selectedTime = time;
    document.querySelectorAll(".slot-btn.selected").forEach((b) => b.classList.remove("selected"));
    btnEl.classList.add("selected");

    el.summary.textContent = `${formatDatePretty(state.selectedDate)} às ${time}`;
    el.form.classList.remove("hidden");
    el.status.textContent = "";
    el.status.className = "form-status";
  }

  async function handleSubmit(evt) {
    evt.preventDefault();
    if (!state.selectedDate || !state.selectedTime) return;

    const payload = {
      action: "book",
      date: state.selectedDate,
      time: state.selectedTime,
      name: document.getElementById("clientName").value.trim(),
      email: document.getElementById("clientEmail").value.trim(),
      phone: document.getElementById("clientPhone").value.trim(),
    };

    if (!payload.name || !payload.email || !payload.phone) return;

    el.confirmBtn.disabled = true;
    el.status.className = "form-status";
    el.status.textContent = "Confirmando sua sessão…";

    try {
      const result = await apiPost(payload);
      if (result.ok) {
        el.status.className = "form-status success";
        el.status.textContent =
          "Sessão confirmada! Você vai receber um e-mail do Google Agenda com os detalhes.";
        showWhatsappLink(payload);
        el.form.reset();
        el.confirmBtn.disabled = true;
        // Refresh slots so the booked time disappears for the next visitor,
        // without hiding the confirmation/WhatsApp button we just showed.
        refreshSlotsForSelectedDate();
      } else {
        el.status.className = "form-status error";
        el.status.textContent = result.message || "Esse horário acabou de ser reservado. Escolha outro.";
        el.confirmBtn.disabled = false;
        if (result.code === "SLOT_TAKEN") {
          selectDate(state.selectedDate, document.querySelector(".day.selected"));
        }
      }
    } catch (err) {
      el.status.className = "form-status error";
      el.status.textContent = "Erro de conexão. Tente novamente em instantes.";
      el.confirmBtn.disabled = false;
      console.error(err);
    }
  }

  /**
   * Monta um link wa.me com a mensagem de confirmação já preenchida,
   * para o cliente enviar ao WhatsApp do estúdio com um toque.
   */
  function showWhatsappLink(payload) {
    const number = (CONFIG.STUDIO_WHATSAPP_NUMBER || "").replace(/\D/g, "");
    if (!number) return; // não configurado — link fica oculto

    const message =
      `Olá! Confirmando minha sessão de Natal com ${document.querySelector(".wordmark").textContent.trim()}.\n` +
      `Nome: ${payload.name}\n` +
      `Data: ${formatDatePretty(payload.date)}\n` +
      `Horário: ${payload.time}`;

    el.whatsappLink.href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    el.whatsappLink.classList.remove("hidden");
  }

  // -----------------------------------------------------------
  // API helpers
  // Apps Script Web Apps don't support CORS preflight (OPTIONS),
  // so GET uses query params and POST uses a text/plain body to
  // keep every request "simple" and preflight-free.
  // -----------------------------------------------------------
  async function apiGet(params) {
    const url = new URL(CONFIG.WEB_APP_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`GET ${res.status}`);
    return res.json();
  }

  async function apiPost(payload) {
    const res = await fetch(CONFIG.WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`POST ${res.status}`);
    return res.json();
  }

  // -----------------------------------------------------------
  // Date helpers
  // -----------------------------------------------------------
  function parseISODate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function toISODate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function formatDatePretty(iso) {
    const d = parseISODate(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", weekday: "long" });
  }
})();
