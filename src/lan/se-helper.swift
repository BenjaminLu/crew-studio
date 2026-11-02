// Crew Studio's Secure Enclave helper for the LAN identity (docs/units/lan-relay.md, src/lan/keystore.ts).
// Built from this source on the Mac that runs it (swiftc, ad-hoc signed), with no entitlements and no Keychain: each key
// is made inside the Secure Enclave and only its dataRepresentation, a blob the enclave wrapped for this one device, is
// handed back for Studio to keep in its data folder. No private key material ever leaves the enclave, so there is none
// to print. Long-lived: one JSON request per line on stdin, one JSON answer per line on stdout, each with the request's id.
//   {"id":n,"op":"available"}                                  -> {"id":n,"ok":true,"se":true|false}
//   {"id":n,"op":"create","kind":"sign"|"dh","presence":bool|"biometry"} -> {"id":n,"ok":true,"blob":b64,"pub":b64url (X9.63)}
//   {"id":n,"op":"pub","kind":"sign"|"dh","blob":b64}          -> {"id":n,"ok":true,"pub":b64url}
//   {"id":n,"op":"sign","blob":b64,"purpose":p,"msg":b64}      -> {"id":n,"ok":true,"sig":b64url (r||s)}   a daily purpose only
//   {"id":n,"op":"dh","blob":b64,"peer":b64url (X9.63)}        -> {"id":n,"ok":true,"secret":b64url (x coordinate)}
//   {"id":n,"op":"admin","blob":b64,"purpose":p,"fields":[..]} -> {"id":n,"ok":true,"sig":b64url}          an admin purpose only
//   {"id":n,"op":"message","purpose":p,"fields":[..]}          -> {"id":n,"ok":true,"msg":b64url,"prompt":s} (golden vectors)
// Every signature is ECDSA P-256 over SHA-256 of "crew-studio/lan/v2" 0 purpose 0 message, the bytes src/lan/crypto.ts
// verifies. An admin signature's message is its fields joined by 0, each field checked here, and the Touch ID prompt is
// built here from those fields (a peer's fingerprint, a key's fingerprint, a sequence number), never from caller text.
import CryptoKit
import Foundation
import LocalAuthentication
import Security

let DOMAIN = "crew-studio/lan/v2"
let DAILY: Set<String> = ["entry", "cert-request"]
let ADMIN: Set<String> = ["cert", "introduce", "revoke", "successor", "replace"]
let BLOB = 4096

func out(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]) else { return }
  FileHandle.standardOutput.write(d); FileHandle.standardOutput.write(Data([0x0a]))
}
struct Refusal: Error { let why: String }
func b64url(_ d: Data) -> String { d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
func unb64url(_ s: String) -> Data? {
  var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  while t.count % 4 != 0 { t += "=" }
  return Data(base64Encoded: t)
}
func field(_ v: Any?, _ name: String, max: Int) throws -> Data {
  guard let s = v as? String, s.count <= max * 2, let d = Data(base64Encoded: s) ?? unb64url(s), d.count <= max else { throw Refusal(why: "bad \(name)") }
  return d
}
/** the fingerprint people compare (src/lan/crypto.ts fingerprint): six groups of five digits from SHA-256 */
func fingerprint(_ pub: Data) -> String {
  var h = SHA256(); h.update(data: Data("\(DOMAIN)\u{0}fingerprint\u{0}".utf8)); h.update(data: pub)
  let d = Array(h.finalize()); var groups: [String] = []
  for i in 0..<6 { var n: UInt64 = 0; for j in 0..<5 { n = (n << 8) | UInt64(d[i * 5 + j]) }; groups.append(String(format: "%05llu", n % 100000)) }
  return groups.joined(separator: " ")
}
func signed(_ purpose: String, _ msg: Data) -> Data { var d = Data("\(DOMAIN)\u{0}\(purpose)\u{0}".utf8); d.append(msg); return d }
/** an admin message: its fields, each 1 to 200 printable ASCII characters with no separator, joined by 0; and the prompt */
func adminMessage(_ purpose: String, _ raw: Any?) throws -> (Data, String) {
  guard ADMIN.contains(purpose) else { throw Refusal(why: "not an admin purpose") }
  guard let fields = raw as? [String], !fields.isEmpty, fields.count <= 8 else { throw Refusal(why: "bad fields") }
  for f in fields { guard f.count >= 1, f.count <= 200, f.unicodeScalars.allSatisfy({ $0.value >= 0x21 && $0.value <= 0x7e }) else { throw Refusal(why: "bad field") } }
  let key = { (i: Int) throws -> String in guard i < fields.count, let d = unb64url(fields[i]), d.count == 65 else { throw Refusal(why: "field \(i) is not a key") }; return fingerprint(d) }
  let num = { (i: Int) throws -> String in guard i < fields.count, let n = UInt64(fields[i]) else { throw Refusal(why: "field \(i) is not a number") }; return String(n) }
  let prompt: String
  switch purpose {
  case "cert": guard fields.count == 4 else { throw Refusal(why: "cert: signing key, key agreement key, from seq, time") }
    prompt = "認證這台 Mac 的日常金鑰（簽章 \(try key(0)) · 協商 \(try key(1))，自第 \(try num(2)) 筆起）"
  case "introduce": guard fields.count == 3 else { throw Refusal(why: "introduce: peer identity, its certificate hash, time") }
    prompt = "核准引介同事：對方指紋 \(try key(0))"
  case "revoke": guard fields.count == 4 else { throw Refusal(why: "revoke: own identity, last seq, successor or -, time") }
    prompt = fields[2] == "-" ? "作廢這台的身分 \(try key(0))（最後一筆 \(try num(1))）" : "作廢這台的身分 \(try key(0))（最後一筆 \(try num(1))），新身分 \(try key(2))"
  case "successor": guard fields.count == 3 else { throw Refusal(why: "successor: old identity, new identity, time") }
    prompt = "確認新身分 \(try key(1)) 接替 \(try key(0))"
  case "replace": guard fields.count == 3 else { throw Refusal(why: "replace: old identity, new identity, time") }
    prompt = "以新身分 \(try key(1)) 取代同事 \(try key(0))（當面確認過短碼）"
  default: throw Refusal(why: "not an admin purpose")
  }
  return (Data(fields.joined(separator: "\u{0}").utf8), prompt)
}
func handle(_ req: [String: Any]) throws -> [String: Any] {
  guard let op = req["op"] as? String else { throw Refusal(why: "no op") }
  let allowed: Set<String> = ["id", "op", "kind", "presence", "blob", "purpose", "msg", "peer", "fields"]
  for k in req.keys where !allowed.contains(k) { throw Refusal(why: "unknown field \(k)") }
  if op == "available" { return ["ok": true, "se": SecureEnclave.isAvailable] }
  if op == "message" { let (m, p) = try adminMessage(req["purpose"] as? String ?? "", req["fields"]); return ["ok": true, "msg": b64url(m), "prompt": p] }
  guard SecureEnclave.isAvailable else { throw Refusal(why: "no Secure Enclave on this Mac") }
  switch op {
  case "create":
    // presence: Touch ID or the login password on every use; "biometry": the fingerprints enrolled now, nothing else (a
    // change of fingerprints makes the key unusable for good)
    let kind = req["kind"] as? String, biometry = (req["presence"] as? String) == "biometry", presence = biometry || ((req["presence"] as? Bool) ?? false)
    var flags: SecAccessControlCreateFlags = [.privateKeyUsage]; if biometry { flags.insert(.biometryCurrentSet) } else if presence { flags.insert(.userPresence) }
    var err: Unmanaged<CFError>?
    guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &err) else { throw Refusal(why: "access control") }
    if kind == "sign" { let k = try SecureEnclave.P256.Signing.PrivateKey(accessControl: ac); return ["ok": true, "blob": k.dataRepresentation.base64EncodedString(), "pub": b64url(k.publicKey.x963Representation)] }
    if kind == "dh" { if presence { throw Refusal(why: "a key agreement key is never made with presence") }
      let k = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: ac); return ["ok": true, "blob": k.dataRepresentation.base64EncodedString(), "pub": b64url(k.publicKey.x963Representation)] }
    throw Refusal(why: "kind is sign or dh")
  case "pub":
    let blob = try field(req["blob"], "blob", max: BLOB)
    if req["kind"] as? String == "sign" { return ["ok": true, "pub": b64url(try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob).publicKey.x963Representation)] }
    if req["kind"] as? String == "dh" { return ["ok": true, "pub": b64url(try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: blob).publicKey.x963Representation)] }
    throw Refusal(why: "kind is sign or dh")
  case "sign":
    guard let purpose = req["purpose"] as? String, DAILY.contains(purpose) else { throw Refusal(why: "not a daily purpose") }
    let blob = try field(req["blob"], "blob", max: BLOB), msg = try field(req["msg"], "msg", max: 256 * 1024)
    let k = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob)
    return ["ok": true, "sig": b64url(try k.signature(for: signed(purpose, msg)).rawRepresentation)]
  case "dh":
    let blob = try field(req["blob"], "blob", max: BLOB), peer = try field(req["peer"], "peer", max: 65)
    guard peer.count == 65 else { throw Refusal(why: "bad peer key") }
    let k = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: blob)
    let s = try k.sharedSecretFromKeyAgreement(with: try P256.KeyAgreement.PublicKey(x963Representation: peer))
    return ["ok": true, "secret": b64url(s.withUnsafeBytes { Data($0) })]
  case "admin":
    let purpose = req["purpose"] as? String ?? "", (msg, prompt) = try adminMessage(purpose, req["fields"])
    let blob = try field(req["blob"], "blob", max: BLOB)
    let ctx = LAContext(); ctx.localizedReason = "Crew Studio：\(prompt)"
    let k = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob, authenticationContext: ctx)
    return ["ok": true, "sig": b64url(try k.signature(for: signed(purpose, msg)).rawRepresentation)]
  default: throw Refusal(why: "unknown op")
  }
}
while let line = readLine(strippingNewline: true) {
  if line.utf8.count > 1 << 20 { out(["ok": false, "error": "request too large"]); continue }
  guard let d = line.data(using: .utf8), let req = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { out(["ok": false, "error": "bad request"]); continue }
  let id = req["id"] as? Int ?? -1
  do { var r = try handle(req); r["id"] = id; out(r) }
  catch let e as Refusal { out(["id": id, "ok": false, "error": e.why]) }
  catch { out(["id": id, "ok": false, "error": "refused by the Secure Enclave: \(error.localizedDescription)"]) }
}
