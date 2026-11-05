// Netlify Function : demande à Lodgify le prix exact d'un séjour (clé API gardée côté serveur).
// Variables d'environnement Netlify :
//   LODGIFY_API_KEY        (obligatoire)  clé « API publique » de Lodgify
//   LODGIFY_PROPERTY_ID    (facultatif)   identifiant du logement, 753381 par défaut
//   LODGIFY_ROOM_TYPE_ID   (facultatif)   identifiant du type de chambre, si Lodgify le demande

function resp(status, body, cache) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache || 'no-store'
    },
    body: JSON.stringify(body)
  };
}

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nightsBetween(a, d) {
  return Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function pickTotal(q) {
  var v = q && (q.total_including_vat != null ? q.total_including_vat : q.amount_gross);
  return typeof v === 'number' && isFinite(v) ? v : null;
}

exports.pickTotal = pickTotal;

exports.handler = async function (event) {
  var key = process.env.LODGIFY_API_KEY;
  if (!key) return resp(500, { error: 'LODGIFY_API_KEY manquante' });

  var qs = (event && event.queryStringParameters) || {};
  var arrival = qs.arrival, departure = qs.departure;
  if (!DATE_RE.test(arrival || '') || !DATE_RE.test(departure || '')) return resp(400, { error: 'dates invalides' });
  var nights = nightsBetween(arrival, departure);
  if (nights < 1 || nights > 60) return resp(400, { error: 'durée invalide' });

  var property = process.env.LODGIFY_PROPERTY_ID || '753381';
  var url = 'https://api.lodgify.com/v2/quote/' + encodeURIComponent(property) +
    '?arrival=' + arrival + '&departure=' + departure;
  var room = process.env.LODGIFY_ROOM_TYPE_ID;
  if (room) {
    url += '&roomTypes[0].Id=' + encodeURIComponent(room) + '&roomTypes[0].guest_breakdown.adults=2';
  }

  try {
    var r = await fetch(url, { headers: { 'X-ApiKey': key, 'Accept': 'application/json' } });
    var text = await r.text();
    var data; try { data = JSON.parse(text); } catch (e) { data = null; }

    // ?debug=1 : renvoie la réponse brute de Lodgify (sans la clé) pour vérifier le format
    if (qs.debug === '1') return resp(200, { status: r.status, lodgify: data || text.slice(0, 2000) });

    if (!r.ok) return resp(200, { ok: false, status: r.status, code: data && (data.code || data.error || data.message) || null });
    var total = pickTotal(data);
    if (total == null) return resp(200, { ok: false, code: 'NoTotal' });
    return resp(200, { ok: true, total: total, currency: (data && data.currency_code) || 'EUR', nights: nights }, 'public, max-age=60');
  } catch (e) {
    return resp(502, { ok: false, error: 'indisponible' });
  }
};

