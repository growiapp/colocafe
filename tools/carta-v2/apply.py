"""Regenera la capa de interfaz «Carta de mostrador» (V2) dentro de index.html.

Fuentes (este directorio): carta_overlay*.css y carta_module.js.
Uso, desde la raíz del repositorio:
    python tools/carta-v2/apply.py            # reescribe index.html
    python tools/carta-v2/apply.py --check    # no escribe; sale con 1 si index.html no coincide con las fuentes
El resultado es index.html autocontenido: la publicación (static.yml) no usa este directorio.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, '..', '..', 'index.html')


def leer(p):
    return open(p, encoding='utf8').read()


s = open(INDEX, encoding='utf8', newline='').read()
CRLF = '\r\n' in s
s = s.replace('\r\n', '\n')
css = ''.join(leer(os.path.join(HERE, f)) for f in ('carta_overlay.css', 'carta_overlay2.css', 'carta_overlay3.css'))
js = leer(os.path.join(HERE, 'carta_module.js'))
b, e = '/*CARTA_V2_BEGIN*/', '/*CARTA_V2_END*/'
i, j = s.index(b), s.index(e) + len(e)
s = s[:i] + b + '\n' + css + e + s[j:]
jb, je = '<!--CARTA_JS_BEGIN-->', '<!--CARTA_JS_END-->'
bloque = jb + '\n<script type="text/x-caja">\n' + js + '</script>\n' + je
if jb in s:
    i, j = s.index(jb), s.index(je) + len(je)
    s = s[:i] + bloque + s[j:]
else:
    k = s.rindex('</body>')
    s = s[:k] + bloque + '\n' + s[k:]
salida = s.replace('\n', '\r\n') if CRLF else s
if '--check' in sys.argv:
    actual = open(INDEX, encoding='utf8', newline='').read()
    print('COINCIDE' if actual == salida else 'DIFERENTE')
    sys.exit(0 if actual == salida else 1)
open(INDEX, 'w', encoding='utf8', newline='').write(salida)
print('aplicado')
