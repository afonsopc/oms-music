# Fontes empacotadas

| Ficheiro | O que é | Licença |
| --- | --- | --- |
| `OMSWide-Regular.ttf` | OMS Wide, a nossa display ultra-larga e ultra-preta (wordmark). **Gerada** por `scripts/generate-oms-wide.py` — não editar o TTF à mão, mexer no gerador e voltar a correr. | SIL OFL 1.1, © 2026 Afonso Coutinho |

Regenerar a OMS Wide (precisa de `fonttools`, `skia-pathops` e `brotli`):

```sh
python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools skia-pathops brotli
/tmp/fontenv/bin/python scripts/generate-oms-wide.py assets/fonts/OMSWide-Regular.ttf
```

Historial: até à 1.1.0 a display era a `DrukWide-Super-Trial.otf`, uma **trial**
da Commercial Type que não pode ser redistribuída nem embutida em produto. A OMS
Wide foi desenhada de raiz com as mesmas proporções (medidas, não decalcadas)
para que nenhum layout mexesse.

## Inter (ronda 2 do redesenho, 2026-11-04)

| Ficheiro | O que é | Licença |
| --- | --- | --- |
| `public/fonts/inter-4-latin*.woff2` | Inter 4 variável (400 a 800), a letra de toda a interface na web e no desktop. | SIL OFL 1.1 |

Os woff2 vêm do Google Fonts já divididos em latin e latin-ext (o latin-ext só
desce quando a página tem letras dessas, por exemplo em letão). Servidos por
nós, nunca de fora. O react-native-web está remendado (`patches/`) para pôr a
`OMS Sans` (a Inter) à cabeça da pilha de sistema: sem isso o Linux e o
Windows caíam na Arial/Liberation. No iOS e no Android a interface fica na
letra do sistema (SF Pro, Roboto).
