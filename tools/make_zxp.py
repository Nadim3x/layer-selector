#!/usr/bin/env python3
"""
make_zxp.py - build and verify a signed Adobe CEP extension package (.zxp).

This is a portable reimplementation of Adobe's ZXPSignCmd packaging step, so the
project can be packaged on Linux/CI (or anywhere Python 3 + OpenSSL exist) with
no Windows/macOS tooling. The output format is byte-compatible with packages
produced by ZXPSignCmd (reverse-engineered from, and verified against, a real
ZXPSignCmd-signed sample: same UCF container, same XMLDSig structure).

ZXP format (Adobe UCF package):
  * ZIP archive, extension .zxp
  * "mimetype" file (stored, uncompressed) containing
    "application/vnd.adobe.air-ucf-package+zip"
  * "META-INF/signatures.xml":
      - per-file <Reference URI="path"><DigestValue> = base64(SHA-256(file bytes))
      - <Manifest Id="PackageContents"> is signed with inclusive C14N
        (empty tags expanded, \r\n -> \n, xmlns injected), digest SHA-256
      - <SignedInfo> is signed with RSA-SHA1 (bare PKCS#1 v1.5 signature),
        canonicalized the same way
      - Signature method: http://www.w3.org/2000/09/xmldsig#rsa-sha1

Usage:
  # create a self-signed dev certificate (once):
  python3 tools/make_zxp.py --make-cert --password <pw>

  # build the package (creates dist/devcert.p12 automatically if missing):
  python3 tools/make_zxp.py --password <pw>

  # verify an existing package's signature and digests:
  python3 tools/make_zxp.py --verify dist/LayerSelector.zxp

Only the Python standard library and the `openssl` CLI are required.
"""

import argparse
import base64
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Files that make up the extension package (relative to the repo root).
INCLUDE_DIRS = ["CSXS", "client", "host", "icons"]
INCLUDE_FILES = []
EXCLUDE_NAMES = {".DS_Store", "Thumbs.db", ".debug"}

XMLDSIG_NS = "http://www.w3.org/2000/09/xmldsig#"
C14N_ALGO = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1"
SHA256_ALGO = "http://www.w3.org/2001/04/xmlenc#sha256"
MIMETYPE = "application/vnd.adobe.air-ucf-package+zip"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def b64(data):
    """Base64-encode with 64-char line wrapping (as ZXPSignCmd writes it)."""
    return base64.b64encode(data).decode("ascii")


def b64_wrapped(data):
    return "\r\n".join(b64(data)[i:i + 64] for i in range(0, len(b64(data)), 64))


def expand_empty_tags(xml):
    """C14N step: expand <X .../> to <X ...></X>."""
    return re.sub(r"<([A-Za-z][\w:.-]*)((?:\s+[^<>]*?)?)\s*/>", r"<\1\2></\1>", xml)


def canonicalize_element(inner_src, open_tag_src, tag_name):
    """
    Inclusive C14N 1.0 of a single element, for the restricted grammar this
    file generates (no attribute value escaping needed):
      1. \r\n / \r -> \n (XML parser line-end normalization)
      2. empty elements expanded to start+end pairs
      3. the in-scope default xmlns of <Signature> is emitted on the element
    Verified against ZXPSignCmd output (digest + RSA-SHA1 signature both match).
    """
    body = inner_src.replace("\r\n", "\n").replace("\r", "\n")
    body = expand_empty_tags(body)
    open_canonical = open_tag_src.replace(
        "<%s" % tag_name, '<%s xmlns="%s"' % (tag_name, XMLDSIG_NS), 1
    )
    return (open_canonical + body + "</%s>" % tag_name).encode("utf-8")


def run_openssl(args, input_bytes=None):
    proc = subprocess.run(["openssl"] + args, input=input_bytes,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr.decode("utf-8", "replace"))
        raise SystemExit("openssl %s failed" % args[0])
    return proc.stdout


# ---------------------------------------------------------------------------
# certificate
# ---------------------------------------------------------------------------

def make_cert(p12_path, password, subject):
    """Create a self-signed RSA-2048 code-signing style dev certificate."""
    os.makedirs(os.path.dirname(p12_path), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        key_pem = os.path.join(tmp, "key.pem")
        cert_pem = os.path.join(tmp, "cert.pem")
        run_openssl(["req", "-x509", "-newkey", "rsa:2048", "-sha256",
                     "-days", "3650", "-nodes",
                     "-keyout", key_pem, "-out", cert_pem,
                     "-subj", subject])
        export = ["pkcs12", "-export",
                  "-inkey", key_pem, "-in", cert_pem,
                  "-out", p12_path, "-passout", "pass:" + password,
                  "-name", "Layer Selector Dev Cert"]
        try:
            run_openssl(export + ["-legacy"])  # OpenSSL 3: RC2/3DES, like ZXPSignCmd
        except SystemExit:
            run_openssl(export)  # OpenSSL 1.x has no -legacy and needs none
    print("Created dev certificate: %s" % p12_path)


def load_p12(p12_path, password):
    """Extract (key_pem, cert_pem) from a PKCS#12 file (clean PEM blocks only)."""
    with tempfile.TemporaryDirectory() as tmp:
        key_pem = os.path.join(tmp, "key.pem")
        cert_pem = os.path.join(tmp, "cert.pem")
        extract = ["pkcs12", "-in", p12_path, "-passin", "pass:" + password,
                   "-nodes", "-nocerts", "-out", key_pem]
        extract2 = ["pkcs12", "-in", p12_path, "-passin", "pass:" + password,
                    "-nokeys", "-clcerts", "-out", cert_pem]
        try:
            run_openssl(extract + ["-legacy"])
            run_openssl(extract2 + ["-legacy"])
        except SystemExit:
            run_openssl(extract)
            run_openssl(extract2)
        key = open(key_pem, "rb").read()
        cert = open(cert_pem, "rb").read()

    def clean(data, marker):
        m = re.search((r"-----BEGIN %s-----.*?-----END %s-----" % (marker, marker)).encode(),
                      data, re.S)
        return m.group(0) + b"\n" if m else b""

    key = clean(key, "PRIVATE KEY") or clean(key, "RSA PRIVATE KEY")
    cert = clean(cert, "CERTIFICATE")
    if not key or not cert:
        raise SystemExit("Could not read key/cert from %s (wrong password?)" % p12_path)
    return key, cert


def cert_der(cert_pem):
    """PEM certificate -> DER bytes."""
    m = re.search(rb"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----",
                  cert_pem, re.S)
    if not m:
        raise SystemExit("No PEM certificate found")
    return base64.b64decode(re.sub(rb"\s", b"", m.group(1)))


# ---------------------------------------------------------------------------
# packaging
# ---------------------------------------------------------------------------

def collect_files():
    """Return (files, dirs) relative paths, like the zip entries ZXPSignCmd makes."""
    files, dirs = [], []
    for name in INCLUDE_FILES:
        files.append(name)
    for d in INCLUDE_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            raise SystemExit("Missing extension folder: %s" % base)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames.sort()
            rel_dir = os.path.relpath(dirpath, ROOT).replace(os.sep, "/")
            dirs.append(rel_dir + "/")
            for f in sorted(filenames):
                if f in EXCLUDE_NAMES:
                    continue
                files.append("%s/%s" % (rel_dir, f))
    return files, dirs


def build_signatures_xml(file_digests):
    """Build META-INF/signatures.xml contents (ZXPSignCmd layout, CRLF)."""
    # Manifest references: mimetype first, then alphabetical (as ZXPSignCmd does).
    ref_lines = []
    for uri in ["mimetype"] + sorted([u for u in file_digests if u != "mimetype"],
                                     key=str.lower):
        ref_lines.append(
            '<Reference URI="%s"><DigestMethod Algorithm="%s"/>'
            "<DigestValue>%s</DigestValue></Reference>" % (uri, SHA256_ALGO, file_digests[uri])
        )
    manifest_inner = "\r\n" + "".join(ref_lines)
    manifest_open = '<Manifest Id="PackageContents">'

    # Digest of the C14N-canonicalized Manifest element.
    canonical_manifest = canonicalize_element(manifest_inner, manifest_open, "Manifest")
    manifest_digest = b64(hashlib.sha256(canonical_manifest).digest())

    signed_info_inner = (
        "\r\n"
        '<CanonicalizationMethod Algorithm="%s"/>\r\n' % C14N_ALGO +
        '<SignatureMethod Algorithm="%s"/>\r\n' % RSA_SHA1 +
        '<Reference Type="%sManifest" URI="#PackageContents">\r\n' % XMLDSIG_NS +
        "<Transforms>\r\n"
        '<Transform Algorithm="%s"/>\r\n' % C14N_ALGO +
        "</Transforms>\r\n"
        '<DigestMethod Algorithm="%s"/>\r\n' % SHA256_ALGO +
        "<DigestValue>%s</DigestValue>\r\n" % manifest_digest +
        "</Reference>\r\n"
    )
    signed_info_open = "<SignedInfo>"
    canonical_signed_info = canonicalize_element(signed_info_inner, signed_info_open, "SignedInfo")

    with tempfile.TemporaryDirectory() as tmp:
        si_path = os.path.join(tmp, "si.bin")
        sig_path = os.path.join(tmp, "sig.bin")
        open(si_path, "wb").write(canonical_signed_info)
        run_openssl(["dgst", "-sha1", "-sign", KEY_PATH, "-out", sig_path, si_path])
        signature = open(sig_path, "rb").read()

    x509_der = cert_der(CERT_PEM)
    x509_b64_wrapped = "\r\n".join(
        b64(x509_der)[i:i + 64] for i in range(0, len(b64(x509_der)), 64)
    )

    xml = (
        "<signatures>\r\n"
        '<Signature xmlns="%s" Id="PackageSignature">\r\n' % XMLDSIG_NS +
        "<SignedInfo>" + signed_info_inner +
        "</SignedInfo>\r\n"
        '<SignatureValue Id="PackageSignatureValue">%s</SignatureValue>\r\n' % b64_wrapped(signature) +
        "\r\n"
        "<KeyInfo>\r\n"
        "<X509Data>\r\n"
        "<X509Certificate>%s</X509Certificate>\r\n" % x509_b64_wrapped +
        "</X509Data>\r\n"
        "</KeyInfo>\r\n"
        "<Object>\r\n"
        + manifest_open + manifest_inner + "</Manifest>\r\n"
        "</Object>\r\n"
        "</Signature>\r\n"
        "</signatures>"
    )
    return xml.encode("utf-8")


def build_zxp(out_path, password):
    files, dirs = collect_files()
    file_digests = {}
    for rel in files:
        if rel == "mimetype":
            continue
        data = open(os.path.join(ROOT, rel), "rb").read()
        file_digests[rel] = b64(hashlib.sha256(data).digest())
    file_digests["mimetype"] = b64(hashlib.sha256(MIMETYPE.encode()).digest())

    sig_xml = build_signatures_xml(file_digests)

    # Entry order: case-insensitive alphabetical, directories included.
    entries = sorted(dirs + files + ["META-INF/", "META-INF/signatures.xml", "mimetype"],
                     key=str.lower)
    tmp_out = out_path + ".tmp"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with zipfile.ZipFile(tmp_out, "w") as z:
        written = set()
        for rel in entries:
            if rel in written:
                continue
            written.add(rel)
            if rel.endswith("/"):
                zi = zipfile.ZipInfo(rel)
                zi.external_attr = (0o040755 << 16) | 0x10
                z.writestr(zi, b"", compress_type=zipfile.ZIP_STORED)
            elif rel == "mimetype":
                zi = zipfile.ZipInfo(rel)
                zi.external_attr = (0o100644 << 16)
                z.writestr(zi, MIMETYPE.encode(), compress_type=zipfile.ZIP_STORED)
            elif rel == "META-INF/signatures.xml":
                zi = zipfile.ZipInfo(rel)
                zi.external_attr = (0o100644 << 16)
                z.writestr(zi, sig_xml, compress_type=zipfile.ZIP_DEFLATED)
            else:
                data = open(os.path.join(ROOT, rel), "rb").read()
                zi = zipfile.ZipInfo(rel)
                zi.external_attr = (0o100644 << 16)
                z.writestr(zi, data, compress_type=zipfile.ZIP_DEFLATED)
    os.replace(tmp_out, out_path)
    print("Wrote %s (%d files, %d bytes)" % (out_path, len(files), os.path.getsize(out_path)))


# ---------------------------------------------------------------------------
# verification
# ---------------------------------------------------------------------------

def verify_zxp(zxp_path):
    """Re-check digests + RSA-SHA1 signature inside a package (any ZXPSignCmd ZXP)."""
    z = zipfile.ZipFile(zxp_path)
    names = z.namelist()
    ok = True

    if "mimetype" not in names or "META-INF/signatures.xml" not in names:
        print("FAIL: missing mimetype or META-INF/signatures.xml")
        return False
    if z.read("mimetype").decode() != MIMETYPE:
        print("FAIL: bad mimetype")
        ok = False

    xml = z.read("META-INF/signatures.xml").decode("utf-8")

    # 1. per-file digests
    manifest_inner = re.search(r'<Manifest Id="PackageContents">(.*?)</Manifest>', xml, re.S).group(1)
    refs = re.findall(r'<Reference URI="([^"]+)"><DigestMethod Algorithm="[^"]+"/>'
                      r"<DigestValue>([^=]+=)</DigestValue></Reference>", manifest_inner)
    for uri, dv in refs:
        if uri not in names:
            print("FAIL: referenced file missing from zip:", uri)
            ok = False
            continue
        if hashlib.sha256(z.read(uri)).digest() != base64.b64decode(dv):
            print("FAIL: digest mismatch:", uri)
            ok = False
    print("file digests: %d checked%s" % (len(refs), "" if ok else " (WITH FAILURES)"))

    # 2. Manifest digest inside SignedInfo
    manifest_open = re.search(r'(<Manifest Id="PackageContents">)', xml).group(1)
    canonical_manifest = canonicalize_element(manifest_inner, manifest_open, "Manifest")
    want = re.search(r"<DigestValue>([^=]+=)</DigestValue>\r?\n</Reference>\r?\n</SignedInfo>", xml).group(1)
    got = b64(hashlib.sha256(canonical_manifest).digest())
    print("manifest digest:", "OK" if want == got else "FAIL (%s != %s)" % (want, got))
    ok = ok and want == got

    # 3. RSA-SHA1 signature over canonical SignedInfo
    si_src = re.search(r"(<SignedInfo>.*?</SignedInfo>)", xml, re.S).group(1)
    si_open = "<SignedInfo>"
    inner = si_src[len("<SignedInfo>"):-len("</SignedInfo>")]
    canonical_si = canonicalize_element(inner, si_open, "SignedInfo")
    sig = base64.b64decode(re.sub(r"\s", "", re.search(
        r'<SignatureValue Id="PackageSignatureValue">(.*?)</SignatureValue>', xml, re.S).group(1)))
    xb64 = re.sub(r"\s", "", re.search(r"<X509Certificate>(.*?)</X509Certificate>", xml, re.S).group(1))
    with tempfile.TemporaryDirectory() as tmp:
        cert_pem = os.path.join(tmp, "c.pem")
        pub_pem = os.path.join(tmp, "p.pem")
        si_bin = os.path.join(tmp, "si.bin")
        sig_bin = os.path.join(tmp, "sig.bin")
        der = base64.b64decode(xb64)
        open(cert_pem, "wb").write(b"-----BEGIN CERTIFICATE-----\n" + base64.encodebytes(der) +
                                   b"-----END CERTIFICATE-----\n")
        open(pub_pem, "wb").write(run_openssl(["x509", "-in", cert_pem, "-pubkey", "-noout"]))
        open(si_bin, "wb").write(canonical_si)
        open(sig_bin, "wb").write(sig)
        proc = subprocess.run(["openssl", "dgst", "-sha1", "-verify", pub_pem,
                               "-signature", sig_bin, si_bin],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    sig_ok = proc.returncode == 0 and b"Verified OK" in proc.stdout
    print("RSA-SHA1 signature:", "OK" if sig_ok else "FAIL")
    ok = ok and sig_ok

    print("VERIFY:", "PASS" if ok else "FAIL")
    return ok


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

KEY_PATH = None
CERT_PEM = None

def main():
    global KEY_PATH, CERT_PEM
    ap = argparse.ArgumentParser(description="Build/verify a signed CEP .zxp package")
    ap.add_argument("--output", default=os.path.join(ROOT, "dist", "LayerSelector.zxp"))
    ap.add_argument("--p12", default=os.path.join(ROOT, "dist", "devcert.p12"))
    ap.add_argument("--password", default=os.environ.get("ZXP_CERT_PASSWORD", "layerselector"))
    ap.add_argument("--subject", default="/C=US/ST=NY/O=MyStudio/CN=Layer Selector")
    ap.add_argument("--make-cert", action="store_true", help="(re)create the self-signed dev cert")
    ap.add_argument("--verify", metavar="ZXP", help="verify an existing .zxp and exit")
    args = ap.parse_args()

    if args.verify:
        raise SystemExit(0 if verify_zxp(args.verify) else 1)

    if args.make_cert or not os.path.exists(args.p12):
        make_cert(args.p12, args.password, args.subject)

    key, cert = load_p12(args.p12, args.password)
    with tempfile.TemporaryDirectory() as tmp:
        KEY_PATH = os.path.join(tmp, "key.pem")
        open(KEY_PATH, "wb").write(key)
        CERT_PEM = cert
        build_zxp(args.output, args.password)

    if not verify_zxp(args.output):
        raise SystemExit("Package verification failed!")
    print("Done. Install with PlayerDebugMode enabled (see README).")


if __name__ == "__main__":
    main()
