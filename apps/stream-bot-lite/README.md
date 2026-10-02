# Stream Bot Lite

Отдельная лёгкая версия Discord-бота без Docker, PostgreSQL, Next.js и Lavalink.

Функциональность:

1. Музыка.
2. Временные голосовые комнаты.
3. Анонсы начала стримов из Twitch, YouTube и VK Видео Live.

Локальная админка управляет временными комнатами и источниками анонсов. Музыка управляется только slash-командами.

## Требования

- Windows / Linux / macOS
- Node.js 22.12+
- Windows: `install.bat` автоматически скачает официальный `yt-dlp.exe` в папку бота
- Linux/macOS: `yt-dlp` должен быть в PATH или задан через YTDLP_PATH

FFmpeg идёт через npm-пакет ffmpeg-static.

## Установка

PowerShell:

    cd apps/stream-bot-lite
    copy .env.example .env
    npm install

Заполни .env минимум:

    DISCORD_TOKEN=
    DISCORD_CLIENT_ID=
    ADMIN_USERNAME=admin
    ADMIN_PASSWORD=

Запуск:

    npm run dev

Сборка:

    npm run build
    npm start

SQLite автоматически создаётся в data/stream-bot.sqlite.

## Музыка

Команды:

- /music play query
- /music queue
- /music skip
- /music pause
- /music resume
- /music stop

query может быть ссылкой или обычным текстом. Для поиска используется yt-dlp с ytsearch1.
YouTube-плейлист по ссылке тоже поддерживается: бот добавляет до 50 первых треков в очередь.

Музыка намеренно сделана без Lavalink: один Node-процесс получает аудио через yt-dlp, ffmpeg-static преобразует его в PCM, а @discordjs/voice отправляет его в Discord.

## Временные комнаты

Открой:

    http://127.0.0.1:3001

Браузер запросит Basic Auth с ADMIN_PASSWORD.

Выбираешь сервер, ID триггер-канала, при необходимости категорию, лимит и приватность.

При входе пользователя в trigger channel бот создаёт голосовую комнату и переносит туда пользователя. Пустая временная комната удаляется.

Список созданных комнат хранится в SQLite, поэтому после перезапуска бот может подчистить оставшиеся пустые комнаты.

## Анонсы

Twitch:

Идентификатор — login канала. Требуются TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET. Бот получает app access token через client credentials и вызывает Helix Get Streams.

YouTube:

Идентификатор — channel ID или URL страницы /live. Для проверки текущего эфира используется yt-dlp, поэтому отдельный YouTube API key не нужен.

VK Видео Live:

Идентификатор — slug канала.

Используется:

    https://api.live.vkvideo.ru/v1/blog/<slug>/public_video_stream

У VK есть официальный VK Video Live DevAPI, но лёгкий адаптер здесь использует публичный web-client endpoint. Он может измениться без обратной совместимости, поэтому этот кусок изолирован в одном методе.

У каждого источника хранится lastLiveId, так что один и тот же эфир не публикуется каждые 30 секунд.

## Шаблон

Можно использовать:

    {platform}
    {channel}
    {title}
    {url}
    {viewers}
    {category}

Пример:

    🔴 {platform} · {channel} сейчас в эфире!
    {title}
    {url}

## Discord permissions

Нужны:

- View Channel
- Send Messages
- Embed Links
- Connect
- Speak
- Move Members
- Manage Channels

Бот не читает сообщения сервера, поэтому Message Content Intent не нужен.

## Нагрузка

Для Ryzen 5 5600G + RTX 3060 12 GB + 32 GB RAM эта версия значительно легче исходной архитектуры Platform.

Бот — один Node-процесс с SQLite. Нет PostgreSQL, отдельного web frontend, Lavalink и worker processes.

Самая заметная нагрузка у бота появляется во время музыки: yt-dlp + ffmpeg. Сам стрим через OBS/RTMP, Sea of Thieves и отдельный TTS/STT будут значительно сильнее влиять на общую загрузку системы.

Для стрима оставляй NVENC на RTX 3060, чтобы не заставлять Ryzen кодировать основной видеопоток.

## Ограничения v0.1

- Не восстанавливает текущий музыкальный трек после рестарта.
- Нет transfer ownership интерфейса для временных комнат.
- Нет OAuth в локальной админке.
- Нет истории анонсов.
- VK адаптер зависит от web-client endpoint.
- YouTube live detection зависит от yt-dlp.
- Один музыкальный канал на сервер.

Это сознательно маленький standalone-срез для домашнего ПК.


## Windows

Для первой установки запусти `install.bat` или корневой `INSTALL-STREAM-BOT.bat`.
После заполнения `.env` запускай `start.bat` или корневой `START-STREAM-BOT.bat`.

В админке Discord-сервер, канал команд, текстовый канал анонсов, trigger-канал и категория выбираются из доступных боту объектов Discord.

Музыкальные команды выполняются в настроенном канале команд, а музыка подключается к голосовому каналу пользователя, который вызвал команду.
