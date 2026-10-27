[English](README.md) | [简体中文](README.zh.md) | [繁體中文](README.zh-hant.md) | [日本語](README.ja.md) | [العربية](README.ar.md) | [Русский](README.ru.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | **Español**

# Diple — resalta y comenta pasajes del chat para la IA (plugin de Hermes Desktop)

Resalta un pasaje de una conversación en Hermes Desktop, escribe un comentario si quieres y envía un lote de ellos con tu próximo mensaje; la IA responde cada comentario uno por uno y puedes saltar entre cada respuesta y su pasaje.

> **El nombre.** La *diple* (›) es la marca que los escribas griegos antiguos ponían en el margen para unir una línea con su comentario — la antecesora de las comillas. El nombre chino 圈批 significa «marcar y comentar».

> **No oficial.** Es un plugin de la comunidad. No lo crea, revisa ni mantiene Nous Research ni el proyecto Hermes Agent.

## Funciones

- **Anotar una selección** — selecciona texto en cualquier mensaje del chat y, en cuanto sueltas el ratón, aparece a su lado un botón **Anotar** (o pulsa <kbd>⌘⇧E</kbd>). El pasaje conserva su origen: qué sesión, qué mensaje, quién lo dijo.
- **Resaltado o comentario** — cada pasaje que añades es una *anotación*. Si le escribes un comentario es un *comentario* (la IA debe responderlo); si lo dejas vacío es un *resaltado* (solo material de contexto).
- **Comentar en el sitio** — junto al pasaje se abre un pequeño editor: el pasaje arriba (Markdown renderizado), tu comentario debajo y **Guardar** / **Guardar y enviar** al pie, con un botón de icono para reemplazar el pasaje por la selección actual.
- **Chinchetas en el original** — el texto anotado se sombrea (los comentarios además se subrayan) y recibe una chincheta numerada en su esquina superior derecha. Pasa el ratón por una chincheta para ver una tarjeta con tres botones: **Editar** (o **Añadir comentario** en un resaltado), **Copiar** y **Eliminar**; una anotación enviada solo ofrece **Copiar**.
- **Una franja sobre el cuadro de texto** — las anotaciones guardadas esperan ahí, por sesión, como fichas numeradas hasta que las envías. Haz clic en una ficha para volver a su pasaje; elimina, borra todo (se puede deshacer) o previsualiza; la lista sobrevive a las recargas.
- **Enviar N ▾** — envía con tu próximo mensaje, o pulsa **Enviar N** para enviar solo las anotaciones. El menú ▾ tiene **Enviar ahora** y **Copiar para la IA** (Markdown, no se envía nada).
- **Marcadores de respuesta** — la IA marca cada párrafo que responde a un comentario; la app lo muestra como una pequeña ficha «↩ Comentario 2» que vuelve al pasaje.
- **Aviso de respuesta omitida** — cuando una respuesta se salta un comentario, se te avisa («El comentario 2 no tuvo respuesta») y puedes devolverlo a pendientes con un clic.
- **Ida y vuelta sin destellos** — al volver a un pasaje solo se desplaza si está fuera de la pantalla, y el pasaje queda resaltado, sin parpadear.
- **Cola mientras responde** — mientras la IA sigue respondiendo, «Enviar tras la respuesta» pone el lote en cola y lo envía al terminar el turno.
- **Vista previa antes de enviar** — ve exactamente qué mostrará la burbuja del chat y qué recibirá la IA, con una estimación de tamaño frente a los límites de contexto del anfitrión.

La interfaz del plugin está disponible en todos los idiomas de Hermes Desktop: **English, 简体中文, 繁體中文, 日本語, العربية, Русский, Français, Deutsch y Español** (el árabe de derecha a izquierda). Por defecto sigue el idioma de la app; también puedes elegir uno en los ajustes del plugin. Las instrucciones que se envían a la IA siguen en chino para las dos interfaces chinas y en inglés para todos los demás idiomas.

## Capturas de pantalla

El editor junto a un pasaje (interfaz en inglés):

![El editor de comentarios: el pasaje arriba, el cuadro de comentario y Save and send / Save al pie](docs/screenshots/editor.png)

Chinchetas numeradas en la esquina superior derecha de cada pasaje; las vecinas se apartan (interfaz en chino y texto de ejemplo):

![Pasajes sombreados con las chinchetas 1, 2 y 3](docs/screenshots/pins.png)

La tarjeta al pasar el ratón por una chincheta, con Editar · Copiar · Eliminar:

![Una tarjeta de chincheta con el comentario y tres botones](docs/screenshots/pin-card.png)

La franja sobre el cuadro de texto y el menú Enviar N ▾ (Enviar ahora, Copiar para la IA):

![Fichas numeradas sobre el cuadro de texto y el menú de envío abierto](docs/screenshots/strip-send-menu.png)

Las capturas se tomaron en un entorno de pruebas con conversaciones inventadas.

## Instalación

El plugin tiene dos mitades: un plugin de escritorio (`plugin.js`) y un pequeño backend en Python (`plugins/diple/`). Hacen falta las dos. En los comandos siguientes, `~/.hermes` es tu carpeta de Hermes; para un perfil con nombre usa `~/.hermes/profiles/<nombre>`.

### Opción A: descargar una versión

1. Descarga `plugin.js`, `plugin.js.sha256`, `diple-python-0.1.0.zip` y `diple-python-0.1.0.zip.sha256` desde la [última versión](https://github.com/waiclay-349687/hermes-diple/releases) y verifícalos:

   ```bash
   shasum -a 256 -c plugin.js.sha256
   shasum -a 256 -c diple-python-0.1.0.zip.sha256
   ```

2. Colócalos en su sitio:

   ```bash
   mkdir -p ~/.hermes/desktop-plugins/diple ~/.hermes/plugins
   cp plugin.js ~/.hermes/desktop-plugins/diple/plugin.js
   unzip -o diple-python-0.1.0.zip -d ~/.hermes/plugins/
   ```

3. Activa el backend y reinicia Hermes Desktop:

   ```bash
   hermes plugins enable diple
   ```

### Opción B: desde el código fuente

Necesita Node.js 22 o posterior.

```bash
git clone https://github.com/waiclay-349687/hermes-diple.git
cd hermes-diple
npm install
node scripts/install.mjs --home ~/.hermes --no-enable
hermes plugins enable diple
```

`scripts/install.mjs` compila `plugin.js` y copia las dos mitades en la carpeta de Hermes indicada con `--home` (nunca adivina una). Después reinicia Hermes Desktop: la mitad en Python solo se carga al iniciar la app.

## Uso

1. Selecciona texto en un mensaje del chat y haz clic en **Anotar** junto a la selección (o pulsa <kbd>⌘⇧E</kbd>). El editor se abre junto al pasaje.
2. Si quieres, escribe un comentario y pulsa <kbd>Intro</kbd> o **Guardar**; un comentario vacío guarda un resaltado. La anotación recibe una chincheta numerada y una ficha sobre el cuadro de texto. Añade tantas como quieras, de esta sesión o de otras.
3. Escribe tu mensaje y envíalo como siempre, o haz clic en **Enviar N** (o pulsa <kbd>⌘⇧↩</kbd>) para enviar solo las anotaciones. Una línea de recibo bajo tu mensaje («3 anotaciones adjuntas · Ver lo que recibió la IA») muestra qué se envió.
4. En la respuesta, haz clic en una ficha «↩ Comentario n» para volver a su pasaje. Si se omitió un comentario, usa **Devolver** en el aviso.

**Copiar** en una tarjeta de chincheta copia el texto de un resaltado, y un comentario como Markdown: el pasaje como cita (`> ` delante de cada línea), una línea en blanco y luego tu comentario — el mismo formato que **Copiar como Markdown** en «Anotaciones de esta sesión». Para convertir un comentario de nuevo en resaltado, vacía su comentario y guarda.

Mientras la IA responde, <kbd>Intro</kbd> orienta el turno en curso y las anotaciones nunca viajan con una orientación; usa **Enviar tras la respuesta** en su lugar.

### Atajos

| Acción | Predeterminado | Notas |
| --- | --- | --- |
| Añadir la selección a la lista de pendientes | <kbd>⌘⇧E</kbd> | Se puede cambiar en los atajos de teclado de la app |
| Enviar la lista de pendientes | <kbd>⌘⇧↩</kbd> | Se puede cambiar |
| Enviar desde la franja | <kbd>⌘↩</kbd> | Con el foco en la franja sobre el cuadro de texto |

Las superficies de trabajo (botón, editor, chinchetas, franja, menús) no muestran estas teclas; la página de ajustes del complemento las enumera.

En Windows y Linux, <kbd>⌘</kbd> es <kbd>Ctrl</kbd>. La paleta de comandos (<kbd>⌘K</kbd>) también tiene «Añadir a pendientes», «Diple: Enviar anotaciones pendientes», «Diple: Vista previa de lo que recibirá la IA», «Diple: Anotaciones de esta sesión» y «Diple: Ajustes» (en el idioma de la interfaz).

## Ajustes

Ábrelos desde la paleta de comandos («Diple: Ajustes») o desde los ajustes de la app.

| Ajuste | Predeterminado | Qué hace |
| --- | --- | --- |
| Activar Diple | activado | Interruptor general. Desactivado detiene los atajos, la lista, el sombreado de los pasajes añadidos y la interacción con los marcadores; los datos se conservan. |
| Mostrar la barra al seleccionar | sí | El botón **Anotar** junto a una selección. Desactivado: usa <kbd>⌘⇧E</kbd> o la paleta de comandos. |
| Idioma | Igual que la app | Igual que la app, o uno de los nueve idiomas, cada uno con su propio nombre. Afecta a la interfaz del plugin; las instrucciones para la IA van en chino con 简体中文 / 繁體中文 y en inglés en los demás casos. |
| Modo discreto: solo chinchetas en el original | desactivado | Los pasajes anotados no llevan sombreado ni subrayado, solo una chincheta numerada al lado. |
| Conservar marcas tras enviar | activado | Las anotaciones enviadas conservan una marca tenue en el original, con «respondida» / «sin respuesta» en la chincheta. |
| Atajos | — | Abre los atajos de teclado de la app para reasignar las dos acciones. |
| Restablecer | — | Vuelve a los valores predeterminados (se conserva el idioma). |

## Cómo funciona

### Qué recibe la IA

La burbuja del chat sigue siendo corta: tu texto, luego una línea por anotación (número, origen, los primeros ~40 caracteres, tu comentario) y una última línea `@diple:<id del lote>`. Esa línea es una referencia de contexto de Hermes: al enviar el turno, el backend del plugin la expande en la **versión completa** — el texto íntegro de cada anotación, su origen, quién lo dijo y el comentario, más unas reglas de respuesta breves (responder a cada comentario; los resaltados son solo contexto). Un pasaje de más de 4000 caracteres conserva sus primeros y últimos 1500. Usa **Vista previa** antes de enviar, o **Ver lo que recibió la IA** después, para ver ambas versiones.

### Marcadores de respuesta

Las reglas de respuesta piden a la IA que ponga un marcador como `::ann{b="<id del lote>" n="1,3"}` delante de cada párrafo que responde a los comentarios 1 y 3. Hermes Desktop renderiza estas directivas; el plugin las dibuja como etiquetas «↩ Comentario 1, 3» y revisa la respuesta en busca de comentarios sin marcador. Los marcadores dentro de código se ignoran.

### Dónde se guardan los datos

- La lista de pendientes y el estado de envío: el almacenamiento de plugins de escritorio de Hermes Desktop (almacenamiento local de la app, claves con el prefijo `hermes.plugin.diple.`).
- Los lotes enviados (necesarios para expandir las referencias `@diple:` y mostrar lo que recibió la IA): SQLite en `~/.hermes/plugin-data/diple/data.db`.

Las decisiones de diseño están en [docs/adr](docs/adr/README.md) y la estructura general en [docs/architecture.md](docs/architecture.md).

## Privacidad

Todo se queda en tu equipo. El plugin no hace peticiones de red por su cuenta, no tiene telemetría y no guarda nada fuera de tu carpeta de Hermes y del almacenamiento local de la app. Las anotaciones llegan a tu proveedor de modelos solo como parte de un mensaje que envías, igual que el texto que escribes.

## Limitaciones conocidas

Las principales (lista completa con sus motivos en [docs/known-limitations.md](docs/known-limitations.md)):

- Si dos ventanas escriben la lista de pendientes de la misma sesión en el mismo instante, puede perderse una de las dos escrituras.
- Una anotación tomada mientras la sesión está ocupada se verifica contra el turno que la produjo; si no se puede establecer, queda marcada como «no verificada» en vez de adivinarse.
- Después de que la app cambie el id de una sesión (por ejemplo, tras comprimir el contexto), se rechaza volver a expandir una referencia `@diple:` antigua en la sesión nueva.
- Aún no hay entrada en el menú contextual: Hermes Desktop no ofrece a los plugins un punto de extensión del menú contextual.

## Compatibilidad

Probado con Hermes Agent **v0.22.5 (2026.9.24)**, commit `bf0203a` (2026-10-22), en macOS. Necesita Hermes Desktop (la CLI sola no carga plugins de escritorio). Otras versiones pueden funcionar pero no se han probado; cuéntanos qué encuentras.

## En qué se diferencia

El catálogo seleccionado tiene un plugin de escritorio relacionado, **quote-ask** (`hermes plugins info quote-ask`): el texto seleccionado llega al campo de entrada como cita en Markdown. Es ligero y sin estado. Diple sirve para revisar una respuesta larga: mantiene una lista de pendientes entre envíos, da a cada comentario un número que la IA debe responder, comprueba las respuestas omitidas, enlaza respuestas y pasajes en ambos sentidos y envía el texto completo mediante una referencia de contexto mientras la burbuja sigue siendo corta. Diple adapta el conversor «selección → Markdown» de quote-ask (MIT, ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Los id de los plugins son distintos (`quote-ask` y `diple`), así que pueden instalarse a la vez.

## Hoja de ruta e incidencias

- [ROADMAP.md](ROADMAP.md) — en qué se trabaja ahora, después y más adelante.
- [Issues](https://github.com/waiclay-349687/hermes-diple/issues) — preguntas abiertas, debates de diseño y limitaciones conocidas.
- [CHANGELOG.md](CHANGELOG.md) — qué cambió en cada versión.
- [CONTRIBUTING.md](CONTRIBUTING.md) — compilación y pruebas.

## Licencia

[MIT](LICENSE). Código de terceros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
