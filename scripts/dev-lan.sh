#!/usr/bin/env bash
set -euo pipefail
umask 077

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"; fi
if [ -z "$LAN_IP" ]; then
  echo "Não encontrei o IP da rede Wi-Fi. Conecte o computador à mesma rede do celular."
  exit 1
fi

CERT_DIR=".data/certs"
mkdir -p "$CERT_DIR"
CA_KEY="$CERT_DIR/lan-ca-key.pem"
CA_CERT="$CERT_DIR/lan-ca.crt"
CERT_KEY="$CERT_DIR/lan-key.pem"
CERT="$CERT_DIR/lan-cert.pem"
CSR="$CERT_DIR/lan.csr"
EXT="$CERT_DIR/lan.ext"

if [ ! -f "$CA_KEY" ] || [ ! -f "$CA_CERT" ]; then
  openssl genrsa -out "$CA_KEY" 3072
  openssl req -x509 -new -sha256 -key "$CA_KEY" -days 3650 -out "$CA_CERT" \
    -subj "/CN=Apple Finanças Local CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
fi

openssl genrsa -out "$CERT_KEY" 2048
openssl req -new -key "$CERT_KEY" -out "$CSR" -subj "/CN=$LAN_IP"
cat > "$EXT" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names
[alt_names]
DNS.1=localhost
IP.1=127.0.0.1
IP.2=$LAN_IP
EOF
openssl x509 -req -in "$CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$CERT" -days 397 -sha256 -extfile "$EXT"
chmod 600 "$CA_KEY" "$CERT_KEY"
rm -f "$CSR" "$EXT" "$CERT_DIR/lan-ca.srl"

export LOCAL_HTTPS=1
echo "Abra https://${LAN_IP}:3000 no celular conectado à mesma rede."
echo "Instale/confie apenas o certificado público: $CA_CERT (compartilhe por AirDrop)."
echo "A chave privada da CA fica protegida em $CA_KEY; nunca a compartilhe."
exec ./node_modules/.bin/next dev --hostname 0.0.0.0 --experimental-https-key "$CERT_KEY" --experimental-https-cert "$CERT"
