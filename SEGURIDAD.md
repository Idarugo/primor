# Seguridad del sitio Primor

Ningún sitio es "imposible de hackear". El objetivo es poner varias capas para que un ataque cueste mucho más de lo que vale, y que si una capa falla, la siguiente lo frene.

Este documento dice qué está protegido hoy, qué **no puede** protegerse sin un servidor, y el plan para producción.

---

## 1. Lo que ya está implementado

### Navegador (todas las páginas)
| Capa | Qué evita | Dónde |
|---|---|---|
| **Content Security Policy con hashes** (Astro `security.csp`, SHA-384) | Inyección de scripts (XSS): solo corre el código que publicamos. Bloquea `<script>` inyectados, `onerror=`, `javascript:` y recursos de otros dominios | `astro.config.mjs` |
| Sin `style=""` ni scripts en línea en el HTML | Permite una CSP estricta, sin `'unsafe-inline'` | Hero, Finale, Nav, pedido |
| Fuentes como archivos, no `data:` | `font-src 'self'` estricto | `astro.config.mjs` |
| Único tercero permitido: el mapa de Google en Contacto | Carga de contenido externo no autorizado | `frame-src` |

### Encabezados HTTP (al publicar)
`public/_headers` (Netlify / Cloudflare Pages) y `vercel.json` (Vercel):
- `Strict-Transport-Security` (solo HTTPS, 2 años, preload)
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` (nadie puede meter el sitio en un iframe para engañar clics)
- `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (cámara, micrófono, ubicación, pagos y sensores apagados)
- `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy`
- `/admin`, `/cuenta` y el checkout: `no-store` (no quedan en caché) y `noindex`

### Código
| Hueco encontrado | Corrección |
|---|---|
| **Redirección abierta**: `/cuenta?volver=//sitio-falso.com` mandaba a un sitio externo después de iniciar sesión | `safeRedirect()` solo acepta rutas del mismo sitio |
| **Catálogo remoto embebido sin escapar**: un `</script>` en los datos de WooCommerce (que ya tiene spam inyectado) podía ejecutar código | `jsonForScript()` escapa `<`, `>` y `&` |
| `innerHTML` en el resumen del checkout | Se arma nodo por nodo con `textContent` |
| `mailto:` armado con el correo del cliente (podía agregar `cc`/`bcc` ocultos) | `mailto()` valida el correo antes de crear el enlace |
| Enlace del aviso del sitio | Solo rutas internas o `https://`, validado al guardar **y** al mostrar |
| Imágenes guardadas en el navegador | `safeImg()` solo acepta rutas propias |

Todo lo que viene de usuarios (nombres, mensajes, direcciones) se muestra como texto, nunca como HTML. Probado: un nombre `<img src=x onerror=…>` aparece como texto y no se ejecuta, ni en la cuenta ni en el admin.

### Accesos
| Dónde | Protección |
|---|---|
| **Admin** | 5 intentos fallidos y se bloquea 15 min. Mensaje neutro ("no pudimos verificar ese acceso") que no revela qué correos son del equipo. Sesión en `sessionStorage` (se cierra con la pestaña), vence a los **30 min sin uso** o a las **8 h**. Cada lectura revisa si la persona sigue en el equipo y con qué rol. Botones de demostración apagables con `PUBLIC_ADMIN_DEMO=false` |
| **Cuenta de cliente** | Sin contraseñas que robar. Código de 6 dígitos con `crypto.getRandomValues`, vence en 10 min, se anula tras 5 intentos fallidos, máximo 3 códigos por correo cada 10 min |
| **Contacto** | Campo trampa para bots, rechazo de envíos en menos de 2,5 s, máximo 3 mensajes cada 10 min |
| **Registro de actividad** | Cada acción del admin queda anotada con quién y cuándo |

### Otros
- `npm audit`: el código del sitio y la API no tienen dependencias vulnerables. Quedan 10 avisos (3 moderados, 7 altos) dentro de `@astrojs/vercel` (`glob`, `minimatch`, `path-to-regexp`, `zod` de su CLI). Son herramientas que se usan **al compilar** para empaquetar la función, no corren en el sitio publicado ni reciben datos de visitantes. La única "solución" automática baja el adaptador a una versión incompatible con Astro 7, así que hay que esperar a que Vercel actualice el adaptador y volver a revisar con `npm audit`. en las dependencias (2 de noviembre de 2026).
- `robots.txt` excluye admin, cuenta, checkout y pedidos de los buscadores (no protege, solo oculta).
- `/.well-known/security.txt` para que alguien que encuentre una falla sepa a quién avisar (falta el correo: `{{correo_seguridad}}`).
- Tipado estricto de TypeScript (`astro check`): 0 errores.

---

## 2. Backend (implementado)

Desde que el sitio tiene servidor, las reglas importantes se cumplen **en el servidor**, no en el navegador:

| Qué | Cómo |
|---|---|
| Datos | Base libSQL/Turso. Nada sensible queda en el navegador salvo el carrito |
| Login del equipo | Contraseña (scrypt, 12+ caracteres) **y** código de app de autenticación (TOTP). Primera cuenta solo con `ADMIN_SETUP_TOKEN`. Contraseña temporal obligatoria de cambiar |
| Sesiones | Token aleatorio en cookie `__Host-`, `HttpOnly; Secure; SameSite=Strict`; en la base solo se guarda su hash. Admin: 30 min sin uso u 8 h en total |
| Permisos | Cada petición vuelve a leer la persona y su rol en la base. Quitar a alguien cierra sus sesiones al instante |
| CSRF | Encabezado propio obligatorio + revisión de `Origin` + cookies `SameSite=Strict` |
| Fuerza bruta | Límites guardados en la base (sirven aunque Vercel tenga muchas instancias): login 5 por correo y 20 por IP cada 15 min; códigos 5 intentos y 3 envíos cada 10 min |
| Pedidos | El servidor recalcula cada precio y revisa stock; el navegador solo envía id y cantidad. Un pedido se ve solo con sesión del dueño de la cuenta o con su enlace privado |
| Errores | El servidor nunca devuelve detalles internos; los registra en sus logs |
| Registro | Cada acción del equipo queda con fecha, persona, rol e IP |

Probado con ataques: precio falseado a $1 (se cobró el real), producto agotado, pedido ajeno, CSRF, origen falso, instalación repetida, contraseña débil, 2FA incorrecto, dueño usando funciones técnicas, sesión de alguien quitado y fuerza bruta.

## 3. Plan para producción (en orden)

### Urgente, antes de cualquier otra cosa
1. **Limpiar el WordPress actual de primor.cl.** Tiene texto spam inyectado en la portada ("watchesbuy.to…") y en una ficha de producto ("La prosa revela…"). Eso indica que **el sitio ya está comprometido**: actualizar WordPress, plugins y tema; cambiar todas las contraseñas (admin, hosting, base de datos, FTP); escanear archivos con Wordfence o similar; revisar usuarios administradores que no conozcan.
2. **Cambiar la contraseña de la cuenta de cliente** que se escribió en el chat de desarrollo.

### Al publicar
3. Configurar en Vercel `TURSO_*`, `ADMIN_SETUP_TOKEN`, `RESEND_API_KEY` y `EMAIL_FROM` (ver README). Los secretos viven solo en Vercel, nunca en el repositorio.
4. Crear la cuenta del informático, activar 2FA, agregar al dueño y luego **borrar `ADMIN_SETUP_TOKEN`**.
5. **Pagos reales** con Webpay Plus o Mercado Pago en su propia página (la tarjeta nunca toca el servidor de Primor). Hoy el pago es simulado.

### Infraestructura
6. **Cloudflare delante del sitio**: firewall de aplicaciones (WAF), protección contra ataques de denegación de servicio y límite de peticiones a `/admin` y `/api`. Opcional: Cloudflare Access para que `/admin` solo abra desde correos del equipo.
7. **Respaldos automáticos diarios** de la base de datos, guardados fuera del servidor, y una restauración de prueba cada mes.
8. **Monitoreo**: alertas por correo ante inicios de sesión del admin desde un país o equipo nuevo, y ante cambios masivos de precios.
9. **Revisar `npm audit` y actualizar dependencias** cada mes. Activar Dependabot si el código vive en GitHub.

### Personas
10. Una cuenta por persona (nada de cuentas compartidas) y quitar el acceso el mismo día que alguien deja el equipo.
11. El informático conserva el rol técnico; el dueño solo el de negocio.

---

## 4. Cómo comprobarlo

```bash
npm run build && npm run preview
```

La CSP no se activa en `npm run dev` (limitación de Vite). Para revisar los encabezados una vez publicado: https://securityheaders.com y https://observatory.mozilla.org.
