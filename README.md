# Primor · sitio, tienda y panel

Sitio de Primor Snacks (Rancagua, desde 1973): portada con scrollytelling, tienda online, "Arma tu caja", cuentas de clientes, contacto y panel de administración con roles.

- **Astro 7** con páginas estáticas y una API que corre como funciones de **Vercel**.
- **Base de datos libSQL**: un archivo local en desarrollo y **Turso** en producción.
- **Seguridad**: CSP con hashes, encabezados HTTP, CSRF, límites por intentos, cookies `HttpOnly`, contraseñas con scrypt y 2FA para el equipo. Detalle en [SEGURIDAD.md](SEGURIDAD.md).

## Desarrollo local

Requiere Node 24 (`nvm use`).

```bash
npm install
cp .env.example .env   # y completa ADMIN_SETUP_TOKEN
npm run dev
```

- Sitio: http://localhost:4321
- Panel: http://localhost:4321/admin. La primera vez pide el `ADMIN_SETUP_TOKEN` para crear la cuenta del informático.
- Sin `RESEND_API_KEY`, los códigos de acceso de clientes aparecen en pantalla y en la consola.
- La base local vive en `data/primor.db` (no se sube a Git).

Otros comandos:

```bash
npm run check            # tipos (TypeScript estricto)
npm run build            # build de producción
npm run import:catalog   # trae precios y stock actuales desde primor.cl
```

## Publicar en Vercel

1. **GitHub**: sube este repositorio (el `.gitignore` ya excluye `.env`, `data/` y `_raw/`).
2. **Vercel → Add New → Project** e importa el repositorio. Vercel detecta Astro solo.
3. **Base de datos**: en el proyecto, **Storage → Marketplace → Turso → Create**. Eso agrega `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. Si la creas a mano en turso.tech, agrégalas tú en **Settings → Environment Variables**.
4. **Variables de entorno** (Settings → Environment Variables, entorno Production):
   | Variable | Para qué |
   |---|---|
   | `ADMIN_SETUP_TOKEN` | Código de un solo uso para crear la primera cuenta del panel. Genera uno con `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
   | `RESEND_API_KEY` | Envío de los códigos de acceso a clientes ([resend.com](https://resend.com), tiene integración con Vercel) |
   | `EMAIL_FROM` | Remitente verificado en Resend, por ejemplo `Primor <no-reply@primor.cl>` |
5. **Deploy**. Luego entra a `https://tu-dominio/admin`, crea la cuenta del informático con el `ADMIN_SETUP_TOKEN`, vincula la app de autenticación y agrega al dueño desde **Equipo y roles**.
6. Cuando el panel ya esté configurado, puedes **borrar `ADMIN_SETUP_TOKEN`** de Vercel: la instalación inicial deja de estar disponible.
7. **Dominio**: Settings → Domains → `primor.cl`.

Los encabezados de seguridad están en `vercel.json` y se aplican solos.
# primor
