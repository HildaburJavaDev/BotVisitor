import 'dotenv/config';
import { VK, Keyboard } from 'vk-io';
import cron from 'node-cron';
import { DateTime } from 'luxon';

import {
  getParticipants,
  saveParticipants,
  saveAnswer,
  getLessonAnswers
} from './storage.js';

import {
  log,
  logError
} from './logger.js';

const {
  VK_TOKEN,
  GROUP_ID,
  ADMIN_ID,
  CHAT_PEER_ID,
  TZ = 'Asia/Novosibirsk',
  ENABLE_SCHEDULE = 'false'
} = process.env;

if (!VK_TOKEN) {
  throw new Error('Не задан VK_TOKEN в .env');
}

if (!GROUP_ID) {
  throw new Error('Не задан GROUP_ID в .env');
}

const vk = new VK({
  token: VK_TOKEN,
  pollingGroupId: Number(GROUP_ID)
});

const STATUSES = {
  on_time: {
    title: 'Буду без опозданий',
    reportTitle: 'Будут без опозданий',
    logTitle: 'будет без опозданий'
  },
  late: {
    title: 'Возможно немного опоздаю',
    reportTitle: 'Возможно опоздают',
    logTitle: 'возможно опоздает'
  },
  absent: {
    title: 'Не буду сегодня',
    reportTitle: 'Не будут сегодня',
    logTitle: 'не будет сегодня'
  }
};

function now() {
  return DateTime.now().setZone(TZ);
}

function getLessonDate() {
  return now().toFormat('yyyy-LL-dd');
}

function getNowIso() {
  return now().toISO();
}

function normalizeText(text) {
  return String(text ?? '').trim();
}
function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function logDebug(title, data = null) {
  if (data === null || data === undefined) {
    log(`[DEBUG] ${title}`);
    return;
  }

  log(`[DEBUG] ${title}: ${safeJson(data)}`);
}
function isAdmin(userId) {
  return Number(ADMIN_ID) === Number(userId);
}

function getParticipantByVkId(vkId) {
  const participants = getParticipants();

  return participants.find(x => Number(x.vkId) === Number(vkId));
}

function upsertParticipant({ vkId, name }) {
  const participants = getParticipants();
  const existing = participants.find(x => Number(x.vkId) === Number(vkId));

  if (existing) {
    existing.name = name;
  } else {
    participants.push({
      vkId: Number(vkId),
      name
    });
  }

  participants.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));

  saveParticipants(participants);
}

async function getVkUserName(vkId) {
  try {
    const users = await vk.api.users.get({
      user_ids: String(vkId)
    });

    const user = users?.[0];

    if (!user) {
      return `id${vkId}`;
    }

    return `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || `id${vkId}`;
  } catch (error) {
    logError(`Не смог получить имя пользователя ${vkId}`, error);
    return `id${vkId}`;
  }
}

async function getKnownName(vkId) {
  const participant = getParticipantByVkId(vkId);

  if (participant?.name) {
    return participant.name;
  }

  return await getVkUserName(vkId);
}

function mention(vkId, name) {
  const safeName = name || `id${vkId}`;
  return `[id${vkId}|${safeName}]`;
}

function createAttendanceKeyboard(lessonDate) {
  return Keyboard.builder()
    .callbackButton({
      label: STATUSES.on_time.title,
      color: Keyboard.POSITIVE_COLOR,
      payload: {
        action: 'attendance',
        lessonDate,
        status: 'on_time'
      }
    })
    .row()
    .callbackButton({
      label: STATUSES.late.title,
      color: Keyboard.PRIMARY_COLOR,
      payload: {
        action: 'attendance',
        lessonDate,
        status: 'late'
      }
    })
    .row()
    .callbackButton({
      label: STATUSES.absent.title,
      color: Keyboard.NEGATIVE_COLOR,
      payload: {
        action: 'attendance',
        lessonDate,
        status: 'absent'
      }
    })
    .inline();
}
function getLessonDisplayDate() {
  const date = now().setLocale('ru');

  return `${date.toFormat('dd.LL.yyyy')} (${date.toFormat('cccc')})`;
}
async function sendAttendanceMessage(peerId) {
  const lessonDate = getLessonDate();
  const lessonDisplayDate = getLessonDisplayDate();

  await vk.api.messages.send({
    peer_id: Number(peerId),
    random_id: Date.now(),
    message:
        `🇷🇺 Сегодня, ${lessonDisplayDate}, занятие в 18:30.\n\n` +
        `Отметьтесь, пожалуйста:`,
    keyboard: createAttendanceKeyboard(lessonDate)
  });

  log(`Отправлено сообщение для отметки. lessonDate=${lessonDate}, peerId=${peerId}`);
}

function splitAnswersByStatus(answers) {
  return {
    onTime: answers.filter(x => x.status === 'on_time'),
    late: answers.filter(x => x.status === 'late'),
    absent: answers.filter(x => x.status === 'absent')
  };
}

function formatAnswerList(items) {
  if (!items.length) {
    return '—';
  }

  return items
    .map(x => `• ${mention(x.vkId, x.name)}`)
    .join('\n');
}

function formatParticipantList(items) {
  if (!items.length) {
    return '—';
  }

  return items
    .map(x => `• ${mention(x.vkId, x.name)}`)
    .join('\n');
}

function buildSummaryText(lessonDate) {
  const participants = getParticipants();
  const answers = getLessonAnswers(lessonDate);

  const answeredIds = new Set(
    answers.map(x => Number(x.vkId))
  );

  const { onTime, late, absent } = splitAnswersByStatus(answers);

  const notAnswered = participants.filter(p => {
    return !answeredIds.has(Number(p.vkId));
  });

  return (
    `Отчет по занятию ${lessonDate}\n\n` +

    `${STATUSES.on_time.reportTitle}:\n` +
    `${formatAnswerList(onTime)}\n\n` +

    `${STATUSES.late.reportTitle}:\n` +
    `${formatAnswerList(late)}\n\n` +

    `${STATUSES.absent.reportTitle}:\n` +
    `${formatAnswerList(absent)}\n\n` +

    `Не отметились:\n` +
    `${formatParticipantList(notAnswered)}`
  );
}

async function sendSummaryToPeer(peerId, lessonDate = getLessonDate()) {
  const message = buildSummaryText(lessonDate);

  await vk.api.messages.send({
    peer_id: Number(peerId),
    random_id: Date.now(),
    message
  });

  log(`Отправлен отчет. lessonDate=${lessonDate}, peerId=${peerId}`);
}

async function sendSummaryToAdmin() {
  if (!ADMIN_ID) {
    log('ADMIN_ID не задан. Не могу отправить отчет админу.');
    return;
  }

  await sendSummaryToPeer(Number(ADMIN_ID));
}

async function handleAttendanceButton(context) {
    console.log("here")
  logDebug('handleAttendanceButton ENTER', {
    userId: context.userId,
    peerId: context.peerId,
    eventId: context.eventId,
    eventPayload: context.eventPayload
  });

  const payload = context.eventPayload;

  if (!payload) {
    logDebug('message_event пришел, но payload пустой', {
      userId: context.userId,
      peerId: context.peerId
    });

    try {
      await context.answer({
        type: 'show_snackbar',
        text: 'Ошибка: пустой payload'
      });
    } catch (error) {
      logError('Не смог ответить на пустой payload', error);
    }

    return;
  }

  if (payload.action !== 'attendance') {
    logDebug('message_event проигнорирован: неизвестный action', payload);

    try {
      await context.answer({
        type: 'show_snackbar',
        text: 'Неизвестная кнопка'
      });
    } catch (error) {
      logError('Не смог ответить на неизвестный action', error);
    }

    return;
  }

  const { lessonDate, status } = payload;

  logDebug('attendance payload разобран', {
    lessonDate,
    status
  });

  if (!lessonDate) {
    logDebug('Ошибка: нет lessonDate в payload', payload);

    await context.answer({
      type: 'show_snackbar',
      text: 'Ошибка: нет даты занятия'
    });

    return;
  }

  if (!STATUSES[status]) {
    logDebug('Ошибка: неизвестный status в payload', payload);

    await context.answer({
      type: 'show_snackbar',
      text: 'Ошибка: неизвестный статус'
    });

    return;
  }

  const vkId = Number(context.userId);

  // ВАЖНО:
  // Сначала отвечаем VK, чтобы у пользователя перестала крутиться кнопка.
  // А уже потом сохраняем данные.
  logDebug('Пробую ответить на callback-кнопку', {
    vkId,
    lessonDate,
    status
  });

  await context.answer({
    type: 'show_snackbar',
    text: `Отметил: ${STATUSES[status].title}`
  });

  logDebug('Ответ на callback-кнопку успешно отправлен');

  logDebug('Пробую получить имя пользователя', {
    vkId
  });

  const name = await getKnownName(vkId);

  logDebug('Имя пользователя получено', {
    vkId,
    name
  });

  logDebug('Пробую сохранить ответ', {
    lessonDate,
    vkId,
    name,
    status
  });

  saveAnswer({
    lessonDate,
    vkId,
    name,
    status,
    updatedAt: getNowIso()
  });

  logDebug('Ответ сохранен в JSON');

  log(`${name} (${vkId}) отметил: ${STATUSES[status].logTitle}. lessonDate=${lessonDate}`);
}

async function handleAddMeCommand(context, args) {
  const vkId = Number(context.senderId);

  let name = args.join(' ').trim();

  if (!name) {
    name = await getVkUserName(vkId);
  }

  upsertParticipant({
    vkId,
    name
  });

  await context.send(`Добавил тебя в список участников: ${mention(vkId, name)}`);

  log(`Участник добавлен через /addme: ${name} (${vkId})`);
}

async function handleAddCommand(context, args) {
  if (!isAdmin(context.senderId)) {
    await context.send('Эта команда только для админа.');
    return;
  }

  const vkIdRaw = args[0];
  const name = args.slice(1).join(' ').trim();

  if (!vkIdRaw || !name) {
    await context.send(
      `Формат:\n` +
      `/add 123456789 Имя Фамилия`
    );
    return;
  }

  const vkId = Number(String(vkIdRaw).replace(/\D/g, ''));

  if (!vkId) {
    await context.send('Не понял vkId. Пример: /add 123456789 Иван Иванов');
    return;
  }

  upsertParticipant({
    vkId,
    name
  });

  await context.send(`Добавил участника: ${mention(vkId, name)}`);

  log(`Участник добавлен админом: ${name} (${vkId})`);
}

async function handleParticipantsCommand(context) {
  const participants = getParticipants();

  if (!participants.length) {
    await context.send(
      `Список участников пуст.\n\n` +
      `Для теста напиши /addme\n` +
      `Или админ может добавить так:\n` +
      `/add 123456789 Имя Фамилия`
    );
    return;
  }

  await context.send(
    `Участники (${participants.length}):\n` +
    formatParticipantList(participants)
  );
}

async function handleHelpCommand(context) {
  const message =
    `Команды бота:\n\n` +

    `/id — показать твой user_id и peer_id диалога\n` +
    `/test — отправить сообщение с кнопками в текущий диалог\n` +
    `/summary — показать отчет за сегодня в текущий диалог\n` +
    `/participants — показать список участников\n` +
    `/addme — добавить себя в список участников\n` +
    `/addme Имя Фамилия — добавить себя с указанным именем\n\n` +

    `Команды админа:\n` +
    `/add 123456789 Имя Фамилия — добавить участника\n` +
    `/send_summary — отправить отчет админу в личку\n\n` +

    `Локальный тест:\n` +
    `1. Напиши /addme\n` +
    `2. Напиши /test\n` +
    `3. Нажми кнопку\n` +
    `4. Напиши /summary`;

  await context.send(message);
}

async function handleMessage(context) {
  if (context.isOutbox) {
    return;
  }

  const text = normalizeText(context.text);

  if (!text) {
    return;
  }

  const [commandRaw, ...args] = text.split(/\s+/);
  const command = commandRaw.toLowerCase();

  try {
    switch (command) {
      case '/start':
      case '/help':
        await handleHelpCommand(context);
        break;

      case '/id':
        await context.send(
          `Твой user_id: ${context.senderId}\n` +
          `peer_id этого диалога: ${context.peerId}\n\n` +
          `Если это беседа, peer_id обычно начинается с 2000000000.`
        );
        break;

      case '/test':
        await sendAttendanceMessage(context.peerId);
        break;

      case '/summary':
        await sendSummaryToPeer(context.peerId);
        break;

      case '/send_summary':
        if (!isAdmin(context.senderId)) {
          await context.send('Эта команда только для админа.');
          return;
        }

        await sendSummaryToAdmin();
        await context.send('Отчет отправлен админу в личку.');
        break;

      case '/participants':
        await handleParticipantsCommand(context);
        break;

      case '/addme':
        await handleAddMeCommand(context, args);
        break;

      case '/add':
        await handleAddCommand(context, args);
        break;

      default:
        await context.send('Не понял команду. Напиши /help');
        break;
    }
  } catch (error) {
    logError(`Ошибка при обработке команды: ${text}`, error);
    await context.send('Произошла ошибка. Подробности записал в logs/bot.log');
  }
}

function setupSchedule() {
  if (ENABLE_SCHEDULE !== 'true') {
    log('Расписание выключено. Для включения поставь ENABLE_SCHEDULE=true в .env');
    return;
  }

  if (!CHAT_PEER_ID) {
    log('CHAT_PEER_ID не задан. Расписание не включено.');
    return;
  }

  if (!ADMIN_ID) {
    log('ADMIN_ID не задан. Отчет админу по расписанию невозможен.');
    return;
  }

  cron.schedule(
    '30 14 * * 1,3',
    async () => {
      try {
        await sendAttendanceMessage(Number(CHAT_PEER_ID));
      } catch (error) {
        logError('Ошибка при отправке сообщения по расписанию', error);
      }
    },
    {
      timezone: TZ
    }
  );

  cron.schedule(
    '25 18 * * 1,3',
    async () => {
      try {
        await sendSummaryToAdmin();
      } catch (error) {
        logError('Ошибка при отправке отчета по расписанию', error);
      }
    },
    {
      timezone: TZ
    }
  );

  log(`Расписание включено. TZ=${TZ}. CHAT_PEER_ID=${CHAT_PEER_ID}. ADMIN_ID=${ADMIN_ID}`);
}

vk.updates.on('message_new', handleMessage);

vk.updates.on('message_event', async context => {
  try {
    await handleAttendanceButton(context);
  } catch (error) {
    logError('Ошибка при обработке нажатия callback-кнопки', error);

    try {
      await context.answer({
        type: 'show_snackbar',
        text: 'Ошибка при сохранении отметки'
      });
    } catch {
      // ignored
    }
  }
});

setupSchedule();

vk.updates.start()
  .then(() => {
    log(`Бот запущен. TZ=${TZ}`);
  })
  .catch(error => {
    logError('Не удалось запустить бота', error);
    process.exit(1);
  });