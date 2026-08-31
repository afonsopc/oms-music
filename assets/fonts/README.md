# Fontes empacotadas

| Ficheiro | O que é | Licença |
| --- | --- | --- |
| `OMSWide-Regular.ttf` | OMS Wide, a nossa display ultra-larga e ultra-preta (wordmark). **Gerada** por `scripts/generate-oms-wide.py` — não editar o TTF à mão, mexer no gerador e voltar a correr. | SIL OFL 1.1, © 2026 Afonso Coutinho |
| `Cantarell-VF.otf` | Cantarell variável (GNOME) | SIL OFL 1.1 |

Regenerar a OMS Wide (precisa de `fonttools`, `skia-pathops` e `brotli`):

```sh
python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools skia-pathops brotli
/tmp/fontenv/bin/python scripts/generate-oms-wide.py assets/fonts/OMSWide-Regular.ttf
```

Historial: até à 1.1.0 a display era a `DrukWide-Super-Trial.otf`, uma **trial**
da Commercial Type que não pode ser redistribuída nem embutida em produto. A OMS
Wide foi desenhada de raiz com as mesmas proporções (medidas, não decalcadas)
para que nenhum layout mexesse.
