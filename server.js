const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// ======================================================
// CONFIGURACIÓN GENERAL
// ======================================================

app.use(express.json());

// Sirve index.html, styles.css y app.js desde esta carpeta.
app.use(express.static(__dirname));

// Conecta al archivo SQLite ubicado al lado de server.js.
const dbPath = path.join(__dirname, 'canchaya.db');
const db = new Database(dbPath);

// Activa las relaciones entre tablas de SQLite.
db.pragma('foreign_keys = ON');

console.log('Base SQLite conectada:', dbPath);

// ======================================================
// FUNCIONES AUXILIARES
// ======================================================

function publicUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        ci: user.ci,
        celular: user.celular,
        email: user.email,
        rol: user.rol,
        activo: user.activo
    };
}

function getAuthenticatedUser(req) {
    const userId = Number(req.header('x-user-id'));

    if (!userId) return null;

    return db.prepare(`
    SELECT *
    FROM usuarios
    WHERE id = ?
      AND activo = 1
  `).get(userId);
}

function requireAdmin(req, res, next) {
    const user = getAuthenticatedUser(req);

    if (!user || user.rol !== 'ADMIN') {
        return res.status(403).json({
            ok: false,
            error: 'Acceso restringido. Solo un administrador puede realizar esta acción.'
        });
    }

    req.admin = user;
    next();
}

function getReservaView(reserva) {
    return db.prepare(`
    SELECT
      r.id,
      r.usuario_id,
      r.cancha_id,
      r.fecha,
      r.hora,
      r.estado,
      u.nombre || ' ' || u.apellido AS usuario,
      u.email,
      u.ci,
      u.celular,
      c.nombre AS cancha,
      c.tipo
    FROM reservas r
    INNER JOIN usuarios u ON u.id = r.usuario_id
    INNER JOIN canchas c ON c.id = r.cancha_id
    WHERE r.id = ?
  `).get(reserva.id);
}

// ======================================================
// API PÚBLICA: CANCHAS
// ======================================================

app.get('/api/canchas', (req, res) => {
    try {
        const canchas = db.prepare(`
      SELECT *
      FROM canchas
      WHERE activa = 1
      ORDER BY tipo, nombre
    `).all();

        res.json({ ok: true, data: canchas });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// API PÚBLICA: EVENTOS
// ======================================================

app.get('/api/eventos', (req, res) => {
    try {
        const eventos = db.prepare(`
      SELECT
        e.*,
        c.nombre AS cancha
      FROM eventos e
      INNER JOIN canchas c ON c.id = e.cancha_id
      WHERE e.estado != 'CANCELADO'
      ORDER BY e.fecha, e.hora
    `).all();

        res.json({ ok: true, data: eventos });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// AUTENTICACIÓN: REGISTRO
// ======================================================

app.post('/api/auth/registro', (req, res) => {
    try {
        const {
            nombre,
            apellido,
            ci,
            celular,
            email,
            password
        } = req.body;

        if (!nombre || !apellido || !ci || !celular || !email || !password) {
            return res.status(400).json({
                ok: false,
                error: 'Completá nombre, apellido, CI, celular, correo y contraseña.'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                ok: false,
                error: 'La contraseña debe tener al menos 6 caracteres.'
            });
        }

        const emailNormalizado = email.trim().toLowerCase();
        const ciNormalizado = String(ci).trim();

        const existe = db.prepare(`
      SELECT id
      FROM usuarios
      WHERE email = ?
         OR ci = ?
    `).get(emailNormalizado, ciNormalizado);

        if (existe) {
            return res.status(409).json({
                ok: false,
                error: 'El correo electrónico o número de CI ya está registrado.'
            });
        }

        const result = db.prepare(`
      INSERT INTO usuarios
      (
        nombre,
        apellido,
        ci,
        celular,
        email,
        password,
        rol,
        activo
      )
      VALUES (?, ?, ?, ?, ?, ?, 'USUARIO', 1)
    `).run(
            nombre.trim(),
            apellido.trim(),
            ciNormalizado,
            celular.trim(),
            emailNormalizado,
            password
        );

        const user = db.prepare(`
      SELECT *
      FROM usuarios
      WHERE id = ?
    `).get(result.lastInsertRowid);

        res.json({
            ok: true,
            user: publicUser(user)
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// AUTENTICACIÓN: LOGIN
// ======================================================

app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                ok: false,
                error: 'Ingresá tu correo electrónico y contraseña.'
            });
        }

        const user = db.prepare(`
      SELECT *
      FROM usuarios
      WHERE email = ?
        AND password = ?
        AND activo = 1
    `).get(email.trim().toLowerCase(), password);

        if (!user) {
            return res.status(401).json({
                ok: false,
                error: 'Correo electrónico o contraseña incorrectos.'
            });
        }

        res.json({
            ok: true,
            user: publicUser(user)
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// USUARIO: EDITAR PERFIL
// El usuario NO puede editar su CI.
// ======================================================

app.put('/api/usuarios/:id/perfil', (req, res) => {
    try {
        const id = Number(req.params.id);
        const loggedUser = getAuthenticatedUser(req);

        if (!loggedUser || loggedUser.id !== id) {
            return res.status(403).json({
                ok: false,
                error: 'No tenés permiso para editar este perfil.'
            });
        }

        const {
            nombre,
            apellido,
            celular,
            email
        } = req.body;

        if (!nombre || !apellido || !celular || !email) {
            return res.status(400).json({
                ok: false,
                error: 'Completá nombre, apellido, celular y correo.'
            });
        }

        const emailNormalizado = email.trim().toLowerCase();

        const correoUsado = db.prepare(`
      SELECT id
      FROM usuarios
      WHERE email = ?
        AND id != ?
    `).get(emailNormalizado, id);

        if (correoUsado) {
            return res.status(409).json({
                ok: false,
                error: 'Ese correo ya está registrado para otro usuario.'
            });
        }

        db.prepare(`
      UPDATE usuarios
      SET
        nombre = ?,
        apellido = ?,
        celular = ?,
        email = ?
      WHERE id = ?
    `).run(
            nombre.trim(),
            apellido.trim(),
            celular.trim(),
            emailNormalizado,
            id
        );

        const updatedUser = db.prepare(`
      SELECT *
      FROM usuarios
      WHERE id = ?
    `).get(id);

        res.json({
            ok: true,
            user: publicUser(updatedUser)
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// USUARIO: CAMBIAR CONTRASEÑA
// ======================================================

app.put('/api/usuarios/:id/password', (req, res) => {
    try {
        const id = Number(req.params.id);
        const loggedUser = getAuthenticatedUser(req);

        if (!loggedUser || loggedUser.id !== id) {
            return res.status(403).json({
                ok: false,
                error: 'No tenés permiso para modificar esta contraseña.'
            });
        }

        const {
            actual,
            nueva,
            confirmacion
        } = req.body;

        if (!actual || !nueva || !confirmacion) {
            return res.status(400).json({
                ok: false,
                error: 'Completá todos los campos de contraseña.'
            });
        }

        if (loggedUser.password !== actual) {
            return res.status(400).json({
                ok: false,
                error: 'La contraseña actual no es correcta.'
            });
        }

        if (nueva.length < 6) {
            return res.status(400).json({
                ok: false,
                error: 'La nueva contraseña debe tener al menos 6 caracteres.'
            });
        }

        if (nueva !== confirmacion) {
            return res.status(400).json({
                ok: false,
                error: 'La confirmación de contraseña no coincide.'
            });
        }

        db.prepare(`
      UPDATE usuarios
      SET password = ?
      WHERE id = ?
    `).run(nueva, id);

        res.json({
            ok: true,
            message: 'Contraseña actualizada correctamente.'
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// USUARIO: LISTAR RESERVAS E HISTORIAL
// ======================================================

app.get('/api/reservas', (req, res) => {
    try {
        const userId = Number(req.query.usuario_id);

        let reservas;

        if (userId) {
            reservas = db.prepare(`
        SELECT
          r.id,
          r.usuario_id,
          r.cancha_id,
          r.fecha,
          r.hora,
          r.estado,
          u.nombre || ' ' || u.apellido AS usuario,
          u.email,
          u.ci,
          u.celular,
          c.nombre AS cancha,
          c.tipo
        FROM reservas r
        INNER JOIN usuarios u ON u.id = r.usuario_id
        INNER JOIN canchas c ON c.id = r.cancha_id
        WHERE r.usuario_id = ?
        ORDER BY r.fecha DESC, r.hora DESC
      `).all(userId);
        } else {
            reservas = db.prepare(`
        SELECT
          r.id,
          r.usuario_id,
          r.cancha_id,
          r.fecha,
          r.hora,
          r.estado,
          u.nombre || ' ' || u.apellido AS usuario,
          u.email,
          u.ci,
          u.celular,
          c.nombre AS cancha,
          c.tipo
        FROM reservas r
        INNER JOIN usuarios u ON u.id = r.usuario_id
        INNER JOIN canchas c ON c.id = r.cancha_id
        ORDER BY r.fecha DESC, r.hora DESC
      `).all();
        }

        res.json({ ok: true, data: reservas });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// RESERVAS: HORARIOS OCUPADOS
// ======================================================

app.get('/api/reservas/ocupadas', (req, res) => {
    try {
        const canchaId = Number(req.query.cancha_id);
        const fecha = req.query.fecha;

        if (!canchaId || !fecha) {
            return res.status(400).json({
                ok: false,
                error: 'Faltan cancha_id o fecha.'
            });
        }

        const horarios = db.prepare(`
      SELECT hora
      FROM reservas
      WHERE cancha_id = ?
        AND fecha = ?
        AND estado IN ('ACTIVA', 'ACEPTADA')
    `).all(canchaId, fecha);

        res.json({
            ok: true,
            data: horarios.map(item => item.hora)
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// RESERVAS: CREAR
// ======================================================

app.post('/api/reservas', (req, res) => {
    try {
        const {
            usuario_id,
            cancha_id,
            fecha,
            hora
        } = req.body;

        const loggedUser = getAuthenticatedUser(req);

        if (!loggedUser || loggedUser.id !== Number(usuario_id)) {
            return res.status(403).json({
                ok: false,
                error: 'Sesión inválida. Iniciá sesión nuevamente.'
            });
        }

        if (!usuario_id || !cancha_id || !fecha || !hora) {
            return res.status(400).json({
                ok: false,
                error: 'Completá cancha, fecha y horario.'
            });
        }

        const cancha = db.prepare(`
      SELECT *
      FROM canchas
      WHERE id = ?
        AND activa = 1
    `).get(cancha_id);

        if (!cancha) {
            return res.status(400).json({
                ok: false,
                error: 'La cancha seleccionada no está disponible.'
            });
        }

        const ocupada = db.prepare(`
      SELECT id
      FROM reservas
      WHERE cancha_id = ?
        AND fecha = ?
        AND hora = ?
        AND estado IN ('ACTIVA', 'ACEPTADA')
    `).get(cancha_id, fecha, hora);

        if (ocupada) {
            return res.status(409).json({
                ok: false,
                error: 'Ese horario ya está ocupado para esta cancha.'
            });
        }

        const result = db.prepare(`
      INSERT INTO reservas
      (
        usuario_id,
        cancha_id,
        fecha,
        hora,
        estado
      )
      VALUES (?, ?, ?, ?, 'ACTIVA')
    `).run(usuario_id, cancha_id, fecha, hora);

        res.json({
            ok: true,
            id: result.lastInsertRowid
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// RESERVAS: CANCELAR
// ======================================================

app.delete('/api/reservas/:id', (req, res) => {
    try {
        const reservaId = Number(req.params.id);
        const loggedUser = getAuthenticatedUser(req);

        const reserva = db.prepare(`
      SELECT *
      FROM reservas
      WHERE id = ?
    `).get(reservaId);

        if (!reserva) {
            return res.status(404).json({
                ok: false,
                error: 'Reserva no encontrada.'
            });
        }

        const esAdmin = loggedUser && loggedUser.rol === 'ADMIN';

        if (!loggedUser || (reserva.usuario_id !== loggedUser.id && !esAdmin)) {
            return res.status(403).json({
                ok: false,
                error: 'No tenés permiso para cancelar esta reserva.'
            });
        }

        db.prepare(`
      UPDATE reservas
      SET estado = 'CANCELADA'
      WHERE id = ?
    `).run(reservaId);

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// ADMIN: ESTADÍSTICAS
// ======================================================

app.get('/api/admin/stats', requireAdmin, (req, res) => {
    try {
        const usuarios = db.prepare(`
      SELECT COUNT(*) AS total
      FROM usuarios
      WHERE rol = 'USUARIO'
    `).get().total;

        const canchas = db.prepare(`
      SELECT COUNT(*) AS total
      FROM canchas
      WHERE activa = 1
    `).get().total;

        const reservas = db.prepare(`
      SELECT COUNT(*) AS total
      FROM reservas
      WHERE estado IN ('ACTIVA', 'ACEPTADA')
    `).get().total;

        const eventos = db.prepare(`
      SELECT COUNT(*) AS total
      FROM eventos
      WHERE estado = 'ABIERTO'
    `).get().total;

        res.json({
            ok: true,
            data: {
                usuarios,
                canchas,
                reservas,
                eventos
            }
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// ADMIN: USUARIOS Y BUSCADOR
// Busca nombre, apellido, CI, correo o celular.
// ======================================================

app.get('/api/admin/usuarios', requireAdmin, (req, res) => {
    try {
        const q = String(req.query.q || '').trim();

        const users = db.prepare(`
      SELECT
        id,
        nombre,
        apellido,
        ci,
        celular,
        email,
        rol,
        activo,
        creado_en
      FROM usuarios
      WHERE
        nombre LIKE ?
        OR apellido LIKE ?
        OR ci LIKE ?
        OR celular LIKE ?
        OR email LIKE ?
      ORDER BY nombre, apellido
    `).all(
            `%${q}%`,
            `%${q}%`,
            `%${q}%`,
            `%${q}%`,
            `%${q}%`
        );

        res.json({ ok: true, data: users });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// ADMIN: EDITAR USUARIO
// El admin sí puede editar CI, rol y estado.
// ======================================================

app.put('/api/admin/usuarios/:id', requireAdmin, (req, res) => {
    try {
        const id = Number(req.params.id);

        const {
            nombre,
            apellido,
            ci,
            celular,
            email,
            rol,
            activo
        } = req.body;

        if (!nombre || !apellido || !ci || !celular || !email) {
            return res.status(400).json({
                ok: false,
                error: 'Completá todos los datos del usuario.'
            });
        }

        const emailNormalizado = email.trim().toLowerCase();
        const ciNormalizado = String(ci).trim();

        const repetido = db.prepare(`
      SELECT id
      FROM usuarios
      WHERE
        (email = ? OR ci = ?)
        AND id != ?
    `).get(emailNormalizado, ciNormalizado, id);

        if (repetido) {
            return res.status(409).json({
                ok: false,
                error: 'El correo o CI ya pertenece a otro usuario.'
            });
        }

        db.prepare(`
      UPDATE usuarios
      SET
        nombre = ?,
        apellido = ?,
        ci = ?,
        celular = ?,
        email = ?,
        rol = ?,
        activo = ?
      WHERE id = ?
    `).run(
            nombre.trim(),
            apellido.trim(),
            ciNormalizado,
            celular.trim(),
            emailNormalizado,
            rol === 'ADMIN' ? 'ADMIN' : 'USUARIO',
            activo ? 1 : 0,
            id
        );

        const updatedUser = db.prepare(`
      SELECT *
      FROM usuarios
      WHERE id = ?
    `).get(id);

        res.json({
            ok: true,
            user: publicUser(updatedUser)
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// ADMIN: CANCHAS
// ======================================================

app.get('/api/admin/canchas', requireAdmin, (req, res) => {
    try {
        const canchas = db.prepare(`
      SELECT *
      FROM canchas
      ORDER BY tipo, nombre
    `).all();

        res.json({ ok: true, data: canchas });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/api/admin/canchas', requireAdmin, (req, res) => {
    try {
        const {
            nombre,
            tipo,
            descripcion,
            precio_hora,
            imagen_url,
            activa
        } = req.body;

        if (!nombre || !['FUTBOL5', 'FUTBOL7'].includes(tipo) || !precio_hora) {
            return res.status(400).json({
                ok: false,
                error: 'Completá nombre, tipo y precio por hora.'
            });
        }

        const result = db.prepare(`
      INSERT INTO canchas
      (
        nombre,
        tipo,
        descripcion,
        precio_hora,
        imagen_url,
        activa
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
            nombre.trim(),
            tipo,
            (descripcion || '').trim(),
            Number(precio_hora),
            (imagen_url || '').trim(),
            activa ? 1 : 0
        );

        const cancha = db.prepare(`
      SELECT *
      FROM canchas
      WHERE id = ?
    `).get(result.lastInsertRowid);

        res.json({ ok: true, data: cancha });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.put('/api/admin/canchas/:id', requireAdmin, (req, res) => {
    try {
        const id = Number(req.params.id);

        const {
            nombre,
            tipo,
            descripcion,
            precio_hora,
            imagen_url,
            activa
        } = req.body;

        if (!nombre || !['FUTBOL5', 'FUTBOL7'].includes(tipo) || !precio_hora) {
            return res.status(400).json({
                ok: false,
                error: 'Completá nombre, tipo y precio por hora.'
            });
        }

        db.prepare(`
      UPDATE canchas
      SET
        nombre = ?,
        tipo = ?,
        descripcion = ?,
        precio_hora = ?,
        imagen_url = ?,
        activa = ?
      WHERE id = ?
    `).run(
            nombre.trim(),
            tipo,
            (descripcion || '').trim(),
            Number(precio_hora),
            (imagen_url || '').trim(),
            activa ? 1 : 0,
            id
        );

        const cancha = db.prepare(`
      SELECT *
      FROM canchas
      WHERE id = ?
    `).get(id);

        if (!cancha) {
            return res.status(404).json({
                ok: false,
                error: 'Cancha no encontrada.'
            });
        }

        res.json({ ok: true, data: cancha });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.delete('/api/admin/canchas/:id', requireAdmin, (req, res) => {
    try {
        const id = Number(req.params.id);

        const tieneReservas = db.prepare(`
      SELECT id
      FROM reservas
      WHERE cancha_id = ?
      LIMIT 1
    `).get(id);

        if (tieneReservas) {
            return res.status(400).json({
                ok: false,
                error: 'No se puede eliminar una cancha con reservas. Desactívala en su lugar.'
            });
        }

        const result = db.prepare(`
      DELETE FROM canchas
      WHERE id = ?
    `).run(id);

        if (!result.changes) {
            return res.status(404).json({
                ok: false,
                error: 'Cancha no encontrada.'
            });
        }

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// ADMIN: RESERVAS
// ======================================================

app.get('/api/admin/reservas', requireAdmin, (req, res) => {
    try {
        const reservas = db.prepare(`
      SELECT
        r.id,
        r.usuario_id,
        r.cancha_id,
        r.fecha,
        r.hora,
        r.estado,
        u.nombre || ' ' || u.apellido AS usuario,
        u.email,
        u.ci,
        u.celular,
        c.nombre AS cancha,
        c.tipo
      FROM reservas r
      INNER JOIN usuarios u ON u.id = r.usuario_id
      INNER JOIN canchas c ON c.id = r.cancha_id
      ORDER BY r.fecha DESC, r.hora DESC
    `).all();

        res.json({ ok: true, data: reservas });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.put('/api/admin/reservas/:id', requireAdmin, (req, res) => {
    try {
        const id = Number(req.params.id);
        const { estado } = req.body;

        const estadosPermitidos = [
            'ACTIVA',
            'ACEPTADA',
            'CANCELADA',
            'COMPLETADA'
        ];

        if (!estadosPermitidos.includes(estado)) {
            return res.status(400).json({
                ok: false,
                error: 'Estado de reserva inválido.'
            });
        }

        const result = db.prepare(`
      UPDATE reservas
      SET estado = ?
      WHERE id = ?
    `).run(estado, id);

        if (!result.changes) {
            return res.status(404).json({
                ok: false,
                error: 'Reserva no encontrada.'
            });
        }

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// ADMIN: EVENTOS
// ======================================================

app.get('/api/admin/eventos', requireAdmin, (req, res) => {
    try {
        const eventos = db.prepare(`
      SELECT
        e.*,
        c.nombre AS cancha
      FROM eventos e
      INNER JOIN canchas c ON c.id = e.cancha_id
      ORDER BY e.fecha DESC, e.hora DESC
    `).all();

        res.json({ ok: true, data: eventos });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/api/admin/eventos', requireAdmin, (req, res) => {
    try {
        const {
            nombre,
            tipo,
            fecha,
            hora,
            cancha_id,
            cupos,
            descripcion,
            estado
        } = req.body;

        if (!nombre || !tipo || !fecha || !hora || !cancha_id || !cupos) {
            return res.status(400).json({
                ok: false,
                error: 'Completá todos los campos del evento.'
            });
        }

        const result = db.prepare(`
      INSERT INTO eventos
      (
        nombre,
        tipo,
        fecha,
        hora,
        cancha_id,
        cupos,
        descripcion,
        estado
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            nombre.trim(),
            tipo,
            fecha,
            hora,
            Number(cancha_id),
            Number(cupos),
            (descripcion || '').trim(),
            estado || 'ABIERTO'
        );

        const evento = db.prepare(`
      SELECT
        e.*,
        c.nombre AS cancha
      FROM eventos e
      INNER JOIN canchas c ON c.id = e.cancha_id
      WHERE e.id = ?
    `).get(result.lastInsertRowid);

        res.json({ ok: true, data: evento });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.put('/api/admin/eventos/:id', requireAdmin, (req, res) => {
    try {
        const id = Number(req.params.id);

        const {
            nombre,
            tipo,
            fecha,
            hora,
            cancha_id,
            cupos,
            descripcion,
            estado
        } = req.body;

        if (!nombre || !tipo || !fecha || !hora || !cancha_id || !cupos) {
            return res.status(400).json({
                ok: false,
                error: 'Completá todos los campos del evento.'
            });
        }

        const result = db.prepare(`
      UPDATE eventos
      SET
        nombre = ?,
        tipo = ?,
        fecha = ?,
        hora = ?,
        cancha_id = ?,
        cupos = ?,
        descripcion = ?,
        estado = ?
      WHERE id = ?
    `).run(
            nombre.trim(),
            tipo,
            fecha,
            hora,
            Number(cancha_id),
            Number(cupos),
            (descripcion || '').trim(),
            estado || 'ABIERTO',
            id
        );

        if (!result.changes) {
            return res.status(404).json({
                ok: false,
                error: 'Evento no encontrado.'
            });
        }

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.delete('/api/admin/eventos/:id', requireAdmin, (req, res) => {
    try {
        const result = db.prepare(`
      DELETE FROM eventos
      WHERE id = ?
    `).run(Number(req.params.id));

        if (!result.changes) {
            return res.status(404).json({
                ok: false,
                error: 'Evento no encontrado.'
            });
        }

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// ADMIN: REPORTE PDF POR RANGO DE FECHAS
// ======================================================

app.get('/api/admin/reportes/pdf', requireAdmin, (req, res) => {
    try {
        const desde = req.query.desde;
        const hasta = req.query.hasta;

        if (!desde || !hasta) {
            return res.status(400).json({
                ok: false,
                error: 'Seleccioná fecha desde y fecha hasta.'
            });
        }

        const reservas = db.prepare(`
      SELECT
        r.fecha,
        r.hora,
        r.estado,
        u.nombre || ' ' || u.apellido AS usuario,
        u.ci,
        u.email,
        c.nombre AS cancha,
        c.tipo
      FROM reservas r
      INNER JOIN usuarios u ON u.id = r.usuario_id
      INNER JOIN canchas c ON c.id = r.cancha_id
      WHERE r.fecha BETWEEN ? AND ?
      ORDER BY r.fecha, r.hora
    `).all(desde, hasta);

        const eventos = db.prepare(`
      SELECT
        e.fecha,
        e.hora,
        e.nombre,
        e.estado,
        e.tipo,
        c.nombre AS cancha
      FROM eventos e
      INNER JOIN canchas c ON c.id = e.cancha_id
      WHERE e.fecha BETWEEN ? AND ?
      ORDER BY e.fecha, e.hora
    `).all(desde, hasta);

        const futbol5 = reservas.filter(item => item.tipo === 'FUTBOL5').length;
        const futbol7 = reservas.filter(item => item.tipo === 'FUTBOL7').length;
        const activas = reservas.filter(item =>
            item.estado === 'ACTIVA' || item.estado === 'ACEPTADA'
        ).length;
        const canceladas = reservas.filter(item =>
            item.estado === 'CANCELADA'
        ).length;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            'attachment; filename=reporte-canchaya.pdf'
        );

        const doc = new PDFDocument({
            margin: 45,
            size: 'A4'
        });

        doc.pipe(res);

        doc.fontSize(22)
            .fillColor('#2563eb')
            .text('CanchaYa - Reporte de actividades');

        doc.moveDown(0.4);

        doc.fontSize(10)
            .fillColor('#475569')
            .text(`Período: ${desde} al ${hasta}`);

        doc.moveDown();

        doc.fontSize(14)
            .fillColor('#1f2937')
            .text('Resumen');

        doc.fontSize(10)
            .fillColor('#475569')
            .text(`Reservas de Fútbol 5: ${futbol5}`)
            .text(`Reservas de Fútbol 7: ${futbol7}`)
            .text(`Reservas activas o aceptadas: ${activas}`)
            .text(`Reservas canceladas: ${canceladas}`)
            .text(`Eventos realizados o programados: ${eventos.length}`);

        doc.moveDown();

        doc.fontSize(14)
            .fillColor('#1f2937')
            .text('Reservas');

        doc.moveDown(0.4);

        doc.fontSize(9).fillColor('#475569');

        if (reservas.length === 0) {
            doc.text('No hay reservas dentro del período seleccionado.');
        }

        reservas.forEach(item => {
            const tipoCancha = item.tipo === 'FUTBOL5'
                ? 'Fútbol 5'
                : 'Fútbol 7';

            doc.text(
                `${item.fecha} ${item.hora} | ${item.cancha} (${tipoCancha}) | ` +
                `${item.usuario} | CI: ${item.ci} | Estado: ${item.estado}`
            );
        });

        doc.moveDown();

        doc.fontSize(14)
            .fillColor('#1f2937')
            .text('Eventos');

        doc.moveDown(0.4);

        doc.fontSize(9).fillColor('#475569');

        if (eventos.length === 0) {
            doc.text('No hay eventos dentro del período seleccionado.');
        }

        eventos.forEach(item => {
            const tipoCancha = item.tipo === 'FUTBOL5'
                ? 'Fútbol 5'
                : 'Fútbol 7';

            doc.text(
                `${item.fecha} ${item.hora} | ${item.nombre} | ` +
                `${item.cancha} | ${tipoCancha} | Estado: ${item.estado}`
            );
        });

        doc.end();
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ======================================================
// PÁGINA PRINCIPAL
// ======================================================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ======================================================
// INICIAR SERVIDOR
// ======================================================

app.listen(PORT, () => {
    console.log(`CanchaYa corriendo en http://localhost:${PORT}`);
    console.log('Base de datos SQLite: canchaya.db');
    console.log('Usuario demo: demo@canchaya.com / demo123');
    console.log('Admin: admin@canchaya.com / admin123');
});