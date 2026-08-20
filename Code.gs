/**
 * Ivanessa Gemaque Retratos — Agendamento da Sessão de Natal
 * Backend em Google Apps Script.
 *
 * Implantação:
 *   Implantar > Nova implantação > Tipo: "Aplicativo da Web"
 *   Executar como: Eu (sua conta)
 *   Quem tem acesso: Qualquer pessoa
 *
 * Antes de implantar, ajuste os valores em CONFIG abaixo.
 */

const CONFIG = {
  CALENDAR_ID: "f3lipe.s@gmail.com",   // ID do Google Agenda (geralmente seu e-mail)
  TIMEZONE: "America/Belem",

  // Janela de dias em que a sessão de Natal é oferecida.
  SESSION_START: "2026-09-01",
  SESSION_END: "2026-09-30",

  // Horário comercial de atendimento.
  WORK_START_HOUR: 9,   // 09:00
  WORK_END_HOUR: 18,    // último início possível é antes das 18:00

  SLOT_MINUTES: 45,     // duração de cada sessão
  BUFFER_MINUTES: 15,   // intervalo entre sessões, para troca de cenário

  STUDIO_NAME: "Ivanessa Gemaque Retratos",
  CREATE_MEET_LINK: false, // requer o serviço avançado "Calendar API" ativado
};

/* ============================================================
 * Roteamento HTTP
 * ============================================================ */

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === "days") {
      return jsonOut({ days: getAvailableDays(e.parameter.month) });
    }
    if (action === "slots") {
      return jsonOut({ slots: getAvailableSlots(e.parameter.date) });
    }
    return jsonOut({ error: "Ação desconhecida." }, 400);
  } catch (err) {
    return jsonOut({ error: String(err) }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action !== "book") {
      return jsonOut({ ok: false, message: "Ação inválida." }, 400);
    }
    return jsonOut(bookSession(body));
  } catch (err) {
    return jsonOut({ ok: false, message: "Erro no servidor: " + String(err) }, 500);
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 * Disponibilidade
 * ============================================================ */

/**
 * Retorna, para um mês "YYYY-MM", a lista de dias ("YYYY-MM-DD")
 * que têm ao menos um horário livre dentro da janela da sessão.
 */
function getAvailableDays(monthStr) {
  const [year, month] = monthStr.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1); // exclusivo

  const windowStart = parseISODate(CONFIG.SESSION_START);
  const windowEnd = addDays(parseISODate(CONFIG.SESSION_END), 1); // exclusivo

  const rangeStart = maxDate(monthStart, windowStart);
  const rangeEnd = minDate(monthEnd, windowEnd);
  if (rangeStart >= rangeEnd) return [];

  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  const events = calendar.getEvents(rangeStart, rangeEnd);
  const busyByDay = groupEventsByDay(events);

  const days = [];
  for (let d = new Date(rangeStart); d < rangeEnd; d = addDays(d, 1)) {
    const iso = toISODate(d);
    const slots = computeSlotsForDay(d, busyByDay[iso] || []);
    if (slots.length > 0) days.push(iso);
  }
  return days;
}

/**
 * Retorna os horários livres ("HH:mm") para uma data específica.
 */
function getAvailableSlots(dateStr) {
  const date = parseISODate(dateStr);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = addDays(dayStart, 1);

  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  const events = calendar.getEvents(dayStart, dayEnd);

  return computeSlotsForDay(date, events);
}

/**
 * Gera os horários candidatos do dia e remove os que colidem com
 * eventos existentes (equivalente a uma checagem de freeBusy) ou
 * que já passaram, caso a data seja hoje.
 */
function computeSlotsForDay(date, busyEvents) {
  const now = new Date();
  const isToday = toISODate(date) === toISODate(now);
  const slotMs = CONFIG.SLOT_MINUTES * 60000;
  const bufferMs = CONFIG.BUFFER_MINUTES * 60000;

  const busyRanges = busyEvents.map((ev) => ({
    start: ev.getStartTime ? ev.getStartTime() : new Date(ev.start),
    end: ev.getEndTime ? ev.getEndTime() : new Date(ev.end),
  }));

  const slots = [];
  let cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate(), CONFIG.WORK_START_HOUR, 0, 0);
  const dayLimit = new Date(date.getFullYear(), date.getMonth(), date.getDate(), CONFIG.WORK_END_HOUR, 0, 0);

  while (cursor.getTime() + slotMs <= dayLimit.getTime()) {
    const slotStart = cursor;
    const slotEnd = new Date(cursor.getTime() + slotMs);

    const overlaps = busyRanges.some(
      (b) => slotStart < b.end && slotEnd > b.start
    );
    const isPast = isToday && slotStart <= now;

    if (!overlaps && !isPast) {
      slots.push(Utilities.formatDate(slotStart, CONFIG.TIMEZONE, "HH:mm"));
    }
    cursor = new Date(cursor.getTime() + slotMs + bufferMs);
  }
  return slots;
}

function groupEventsByDay(events) {
  const map = {};
  events.forEach((ev) => {
    const iso = toISODate(ev.getStartTime());
    if (!map[iso]) map[iso] = [];
    map[iso].push(ev);
  });
  return map;
}

/* ============================================================
 * Criação do agendamento
 * ============================================================ */

function bookSession(body) {
  const { date, time, name, email, phone } = body;

  if (!date || !time || !name || !email || !phone) {
    return { ok: false, message: "Preencha todos os campos." };
  }

  const [hh, mm] = time.split(":").map(Number);
  const d = parseISODate(date);
  const startTime = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0);
  const endTime = new Date(startTime.getTime() + CONFIG.SLOT_MINUTES * 60000);

  // Revalida a disponibilidade no momento da reserva, para evitar
  // que dois clientes reservem o mesmo horário ao mesmo tempo.
  const stillFree = getAvailableSlots(date).includes(time);
  if (!stillFree) {
    return {
      ok: false,
      code: "SLOT_TAKEN",
      message: "Esse horário acabou de ser reservado. Escolha outro, por favor.",
    };
  }

  const title = `Sessão de Natal — ${name}`;
  const description =
    `Cliente: ${name}\n` +
    `E-mail: ${email}\n` +
    `Telefone: ${phone}\n\n` +
    `Agendado pelo site de ${CONFIG.STUDIO_NAME}.`;

  let eventLink = "";
  let meetLink = "";

  if (CONFIG.CREATE_MEET_LINK && typeof Calendar !== "undefined") {
    // Usa o serviço avançado do Calendar para gerar sala do Meet.
    const event = {
      summary: title,
      description: description,
      start: { dateTime: startTime.toISOString(), timeZone: CONFIG.TIMEZONE },
      end: { dateTime: endTime.toISOString(), timeZone: CONFIG.TIMEZONE },
      attendees: [{ email: email }],
      conferenceData: {
        createRequest: {
          requestId: Utilities.getUuid(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };
    const created = Calendar.Events.insert(event, CONFIG.CALENDAR_ID, {
      sendUpdates: "all",
      conferenceDataVersion: 1,
    });
    eventLink = created.htmlLink;
    meetLink = created.hangoutLink || "";
  } else {
    // Fallback simples via CalendarApp (sem link de Meet automático).
    const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
    const created = calendar.createEvent(title, startTime, endTime, {
      description: description,
      guests: email,
      sendInvites: true,
    });
    eventLink = created.getId();
  }

  return { ok: true, eventLink, meetLink };
}

/* ============================================================
 * Utilitários de data
 * ============================================================ */

function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISODate(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, "yyyy-MM-dd");
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function maxDate(a, b) { return a > b ? a : b; }
function minDate(a, b) { return a < b ? a : b; }
