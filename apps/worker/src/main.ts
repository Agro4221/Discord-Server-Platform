const startedAt = new Date().toISOString();

console.log(JSON.stringify({
  ts: startedAt,
  level: "INFO",
  message: "DSP worker placeholder started"
}));

setInterval(() => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: "INFO",
    message: "DSP worker heartbeat"
  }));
}, 30_000);
