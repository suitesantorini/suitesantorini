// Netlify Function : lit le calendrier iCal de Lodgify et renvoie les nuits déjà réservées.
// Le lien iCal est stocké dans une variable d'environnement Netlify (LODGIFY_ICAL_URL), jamais dans le code.

function resp(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    },
    body: JSON.stringify(body)
  };
}

function toUtcDate(v) {
  // v : 20261110 ou 20261110T150000Z
  var m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function isoDay(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function parseIcs(text) {
  // Dépliage des lignes coupées (RFC 5545)
  var unfolded = text.replace(/\r?\n[ \t]/g, '');
  var lines = unfolded.split(/\r?\n/);
  var nights = {};
  var ev = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { ev = {}; return; }
    if (line === 'END:VEVENT') {
      if (ev && ev.start && !/CANCELLED/i.test(ev.status || '')) {
        var s = ev.start;
        var e = ev.end && ev.end > s ? ev.end : s + 86400000;
        var guard = 0;
        for (var t = s; t < e && guard < 400; t += 86400000, guard++) nights[isoDay(t)] = true;
      }
      ev = null;
      return;
    }
    if (!ev) return;
    var idx = line.indexOf(':');
    if (idx < 0) return;
    var key = line.slice(0, idx).split(';')[0].toUpperCase();
    var val = line.slice(idx + 1).trim();
    if (key === 'DTSTART') ev.start = toUtcDate(val);
    else if (key === 'DTEND') ev.end = toUtcDate(val);
    else if (key === 'STATUS') ev.status = val;
  });
  return Object.keys(nights).sort();
}

exports.parseIcs = parseIcs;

exports.handler = async function () {
  var url = process.env.LODGIFY_ICAL_URL;
  if (!url) return resp(500, { error: 'LODGIFY_ICAL_URL manquante' });
  try {
    var r = await fetch(url, { headers: { 'User-Agent': 'suite-santorini-availability' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var text = await r.text();
    return resp(200, { booked: parseIcs(text), updated: new Date().toISOString() });
  } catch (e) {
    return resp(502, { error: 'indisponible' });
  }
};
