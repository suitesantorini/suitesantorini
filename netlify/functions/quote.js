// Netlify Function : demande à Lodgify le prix exact d'un séjour (clé API gardée côté serveur).
// Variables d'environnement Netlify :
//   LODGIFY_API_KEY        (obligatoire)  clé « API publique » de Lodgify
//   LODGIFY_PROPERTY_ID    (facultatif)   identifiant du logement, 753381 par défaut
//   LODGIFY_ROOM_TYPE_ID   (facultatif)   identifiant du type de chambre (sinon trouvé automatiquement)

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

// Trouve tout seul l'identifiant du type de chambre (Lodgify l'exige pour calculer un prix)
var roomCache = null;
function findRoomId(prop) {
  var rooms = prop && (prop.rooms || prop.room_types || prop.roomTypes);
  if (Array.isArray(rooms) && rooms.length) {
    var r = rooms[0];
    var id = r.id != null ? r.id : (r.room_type_id != null ? r.room_type_id : r.Id);
    if (id != null) return String(id);
  }
  return null;
}

exports.pickTotal = pickTotal;
exports.findRoomId = findRoomId;

exports.handler = async function (event) {
  var key = process.env.LODGIFY_API_KEY;
  if (!key) return resp(500, { error: 'LODGIFY_API_KEY manquante' });

  var qs = (event && event.queryStringParameters) || {};
  var arrival = qs.arrival, departure = qs.departure;
  if (!DATE_RE.test(arrival || '') || !DATE_RE.test(departure || '')) return resp(400, { error: 'dates invalides' });
  var nights = nightsBetween(arrival, departure);
  if (nights < 1 || nights > 60) return resp(400, { error: 'durée invalide' });

  var property = process.env.LODGIFY_PROPERTY_ID || '753381';
  var headers = { 'X-ApiKey': key, 'Accept': 'application/json' };
  var base = 'https://api.lodgify.com/v2/';
  try {
    // ?info=1 : montre le logement tel que Lodgify le décrit (pour repérer le bon identifiant de chambre)
    if (qs.info === '1') {
      var ri = await fetch(base + 'properties/' + encodeURIComponent(property), { headers: headers });
      var ti = await ri.text(); var di; try { di = JSON.parse(ti); } catch (e) { di = null; }
      return resp(200, { status: ri.status, roomId: findRoomId(di), lodgify: di ? { id: di.id, name: di.name, rooms: di.rooms } : ti.slice(0, 2000) });
    }

    var room = process.env.LODGIFY_ROOM_TYPE_ID || roomCache;
    if (!room) {
      var rp = await fetch(base + 'properties/' + encodeURIComponent(property), { headers: headers });
      var tp = await rp.text(); var dp; try { dp = JSON.parse(tp); } catch (e) { dp = null; }
      room = findRoomId(dp);
      if (room) roomCache = room;
    }
    var url = base + 'quote/' + encodeURIComponent(property) + '?arrival=' + arrival + '&departure=' + departure;
    if (room) url += '&roomTypes[0].Id=' + encodeURIComponent(room) + '&roomTypes[0].guest_breakdown.adults=2';

    var r = await fetch(url, { headers: headers });
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
