const API = '/api';

let user = null;
let canchas = [];
let canchaSeleccionada = null;
let horaSeleccionada = null;
let canchasEstado = 'idle';

const HORAS = [
    '08:00', '09:00', '10:00', '11:00', '12:00', '13:00',
    '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
    '20:00', '21:00', '22:00'
];

function $(id) {
    return document.getElementById(id);
}

function headers() {
    return {
        'Content-Type': 'application/json',
        'x-user-id': user ? user.id : ''
    };
}

/* =========================================================
   COMUNICACIÓN CON LA API
   Todas las operaciones HTTP del frontend pasan por fetch().
   ========================================================= */
async function request(url, options = {}) {
    try {
        const response = await fetch(`${API}${url}`, {
            ...options,
            headers: {
                ...headers(),
                ...(options.headers || {})
            }
        });

        let data;
        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok) {
            return {
                ok: false,
                error: data.error || `Error HTTP ${response.status}`,
                data: data.data || null
            };
        }

        return data;
    } catch (error) {
        return {
            ok: false,
            error: 'No se pudo establecer comunicación con la API.',
            detail: error.message,
            data: null
        };
    }
}

function mostrarMensaje(id, mensaje, correcto = false) {
    const element = $(id);
    if (!element) return;
    element.textContent = mensaje;
    element.style.color = correcto ? '#15803d' : '#dc2626';
}

function formatTipo(tipo) {
    if (tipo === 'FUTBOL5') return 'Fútbol 5';
    if (tipo === 'FUTBOL7') return 'Fútbol 7';
    return tipo || 'Sin tipo';
}

function formatDinero(valor) {
    return `Gs. ${Number(valor || 0).toLocaleString('es-PY')}`;
}

function escapeHtml(valor) {
    return String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

/* =========================================================
   LOGIN Y REGISTRO
   ========================================================= */
function authTab(tab) {
    $('login-form').classList.toggle('hidden', tab !== 'login');
    $('register-form').classList.toggle('hidden', tab !== 'register');
    $('login-tab').classList.toggle('active', tab === 'login');
    $('register-tab').classList.toggle('active', tab === 'register');
}

async function login() {
    const email = $('login-email').value.trim();
    const password = $('login-password').value;

    if (!email || !password) {
        mostrarMensaje('login-msg', 'Completá el correo y la contraseña.');
        return;
    }

    const resultado = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });

    if (!resultado.ok) {
        mostrarMensaje('login-msg', resultado.error || 'No fue posible iniciar sesión.');
        return;
    }

    iniciarSesion(resultado.user);
}

async function register() {
    const nombre = $('r-nombre').value.trim();
    const apellido = $('r-apellido').value.trim();
    const ci = $('r-ci').value.trim();
    const celular = $('r-celular').value.trim();
    const email = $('r-email').value.trim();
    const password = $('r-password').value;

    if (!nombre || !apellido || !ci || !celular || !email || !password) {
        mostrarMensaje('register-msg', 'Completá nombre, apellido, CI, celular, correo y contraseña.');
        return;
    }

    if (password.length < 6) {
        mostrarMensaje('register-msg', 'La contraseña debe tener al menos 6 caracteres.');
        return;
    }

    const resultado = await request('/auth/registro', {
        method: 'POST',
        body: JSON.stringify({ nombre, apellido, ci, celular, email, password })
    });

    if (!resultado.ok) {
        mostrarMensaje('register-msg', resultado.error || 'No fue posible crear la cuenta.');
        return;
    }

    iniciarSesion(resultado.user);
}

function iniciarSesion(usuario) {
    user = usuario;
    $('auth-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('hello').textContent = `Hola, ${user.nombre}`;
    $('admin-nav').classList.toggle('hidden', user.rol !== 'ADMIN');
    view(user.rol === 'ADMIN' ? 'admin' : 'home');
}

function logout() {
    user = null;
    canchas = [];
    $('app').classList.add('hidden');
    $('auth-screen').classList.remove('hidden');
    $('login-email').value = '';
    $('login-password').value = '';
    authTab('login');
}

/* =========================================================
   NAVEGACIÓN
   ========================================================= */
function view(vista) {
    const views = ['home', 'canchas', 'eventos', 'panel', 'admin'];

    views.forEach(item => {
        const element = $(`v-${item}`);
        if (element) element.classList.toggle('hidden', item !== vista);
    });

    if (vista === 'canchas') loadCanchas();
    if (vista === 'eventos') loadEventos();
    if (vista === 'panel') cargarPanel();
    if (vista === 'admin') cargarAdmin();

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================
   CANCHAS
   GET /api/canchas, JSON, carga, éxito, error y visualización.
   ========================================================= */
function mostrarEstadoCanchas(estado, mensaje = '') {
    const element = $('cancha-estado');
    if (!element) return;

    canchasEstado = estado;
    element.className = 'box';

    if (estado === 'loading') {
        element.classList.add('muted');
        element.textContent = mensaje || 'Cargando canchas desde la API...';
        return;
    }

    if (estado === 'success') {
        element.style.color = '#15803d';
        element.style.borderColor = '#86efac';
        element.style.background = '#f0fdf4';
        element.textContent = mensaje || 'Canchas cargadas correctamente.';
        return;
    }

    if (estado === 'error') {
        element.style.color = '#b91c1c';
        element.style.borderColor = '#fca5a5';
        element.style.background = '#fef2f2';
        element.innerHTML = `
            <div class="section-row">
                <span>${escapeHtml(mensaje || 'No se pudieron cargar las canchas.')}</span>
                <button type="button" class="secondary" onclick="loadCanchas()">
                    Reintentar
                </button>
            </div>
        `;
        return;
    }

    element.textContent = '';
}

async function loadCanchas() {
    const lista = $('cancha-list');
    if (!lista) return;

    mostrarEstadoCanchas('loading', 'Cargando canchas desde la API...');
    lista.setAttribute('aria-busy', 'true');
    lista.innerHTML = '<p class="muted">Obteniendo información de las canchas...</p>';

    try {
        
        const response = await fetch(`${API}/canchas`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'x-user-id': user ? user.id : ''
            }
        });

        if (!response.ok) {
            throw new Error(`La API respondió con HTTP ${response.status}.`);
        }

        const resultado = await response.json();

        if (!resultado.ok) {
            throw new Error(resultado.error || 'La API no pudo obtener las canchas.');
        }

        canchas = Array.isArray(resultado.data) ? resultado.data : [];
        renderCanchas('all');
        mostrarEstadoCanchas(
            'success',
            `${canchas.length} cancha(s) obtenida(s) correctamente desde la API.`
        );
    } catch (error) {
        console.error('Error al obtener las canchas:', error);
        canchas = [];
        lista.innerHTML = '<p class="muted">Verificá que el servidor esté activo y volvé a intentarlo.</p>';
        mostrarEstadoCanchas('error', `No se pudieron cargar las canchas. ${error.message}`);
    } finally {
        lista.setAttribute('aria-busy', 'false');
    }
}

function renderCanchas(filtro = 'all') {
    const listaElement = $('cancha-list');
    if (!listaElement) return;

    const lista = filtro === 'all'
        ? canchas
        : canchas.filter(cancha => cancha.tipo === filtro);

    if (!lista.length) {
        listaElement.innerHTML = '<p class="muted">No hay canchas disponibles para el filtro seleccionado.</p>';
        return;
    }

    listaElement.innerHTML = lista.map(cancha => `
        <article class="card">
            <img src="${escapeHtml(cancha.imagen_url || '')}"
                 alt="${escapeHtml(cancha.nombre)}"
                 onerror="this.style.display='none'">

            <div class="card-body">
                <span class="badge">${escapeHtml(formatTipo(cancha.tipo))}</span>
                <h3>${escapeHtml(cancha.nombre)}</h3>
                <p>${escapeHtml(cancha.descripcion || 'Cancha deportiva disponible para reservas.')}</p>

                <div class="card-foot">
                    <strong>${escapeHtml(formatDinero(cancha.precio_hora))}/h</strong>
                    <button type="button" class="primary" onclick="reserve(${Number(cancha.id)})">
                        Reservar
                    </button>
                </div>
            </div>
        </article>
    `).join('');
}

function filtrarCanchas(filtro, boton = null) {
    document.querySelectorAll('[data-filtro-cancha]').forEach(element => {
        element.classList.remove('active');
    });

    if (boton) boton.classList.add('active');
    renderCanchas(filtro);
}

/* =========================================================
   RESERVAS   
   ========================================================= */
function abrirModal(html) {
    $('modal-content').innerHTML = html;
    $('modal').classList.remove('hidden');
}

function closeModal() {
    $('modal').classList.add('hidden');
    $('modal-content').innerHTML = '';
}

async function reserve(id) {
    canchaSeleccionada = canchas.find(cancha => Number(cancha.id) === Number(id));

    if (!canchaSeleccionada) {
        alert('No se encontró la cancha seleccionada.');
        return;
    }

    horaSeleccionada = null;
    const hoy = new Date().toISOString().slice(0, 10);

    abrirModal(`
        <h2>${escapeHtml(canchaSeleccionada.nombre)}</h2>
        <p class="muted">
            ${escapeHtml(formatTipo(canchaSeleccionada.tipo))}
            · ${escapeHtml(formatDinero(canchaSeleccionada.precio_hora))}/h
        </p>

        <label for="res-date">Fecha</label>
        <input id="res-date" type="date" min="${hoy}" value="${hoy}" onchange="cargarHoras()" required>

        <label>Horario disponible</label>
        <div id="hours" class="grid grid-cols-3 gap-2"></div>

        <button type="button" class="primary full" onclick="confirmReserve()">
            Confirmar reserva
        </button>
        <p id="res-msg"></p>
    `);

    await cargarHoras();
}

async function cargarHoras() {
    const fechaElement = $('res-date');
    const horasElement = $('hours');

    if (!fechaElement || !horasElement || !canchaSeleccionada) return;

    const fecha = fechaElement.value;
    horaSeleccionada = null;
    horasElement.innerHTML = '<p class="muted">Consultando horarios disponibles...</p>';

    const resultado = await request(
        `/reservas/ocupadas?cancha_id=${canchaSeleccionada.id}&fecha=${encodeURIComponent(fecha)}`
    );

    if (!resultado.ok) {
        horasElement.innerHTML = '<p style="color:#dc2626">No se pudieron cargar los horarios disponibles.</p>';
        return;
    }

    const ocupadas = Array.isArray(resultado.data) ? resultado.data : [];

    horasElement.innerHTML = HORAS.map(hora => {
        const ocupada = ocupadas.some(valor => String(valor).slice(0, 5) === hora);
        return `
            <button type="button"
                    ${ocupada ? 'disabled' : ''}
                    class="${ocupada ? 'danger' : 'secondary'}"
                    onclick="chooseHour('${hora}', this)">
                ${hora}
            </button>
        `;
    }).join('');
}

function chooseHour(hora, boton) {
    horaSeleccionada = hora;
    document.querySelectorAll('#hours button').forEach(item => item.classList.remove('active'));
    boton.classList.add('active');
}

async function confirmReserve() {
    if (!user || !user.id) {
        mostrarMensaje('res-msg', 'Debés iniciar sesión para realizar una reserva.');
        return;
    }

    if (!canchaSeleccionada || !$('res-date').value || !horaSeleccionada) {
        mostrarMensaje('res-msg', 'Seleccioná una fecha y un horario disponible.');
        return;
    }

    const resultado = await request('/reservas', {
        method: 'POST',
        body: JSON.stringify({
            usuario_id: user.id,
            cancha_id: canchaSeleccionada.id,
            fecha: $('res-date').value,
            hora: horaSeleccionada
        })
    });

    if (!resultado.ok) {
        mostrarMensaje('res-msg', resultado.error || 'No se pudo crear la reserva.');
        return;
    }

    mostrarMensaje('res-msg', 'Reserva creada correctamente.', true);
    setTimeout(() => {
        closeModal();
        view('panel');
    }, 700);
}

/* =========================================================
   EVENTOS
   ========================================================= */
async function loadEventos() {
    const lista = $('event-list');
    lista.innerHTML = '<p class="muted">Cargando eventos...</p>';

    const resultado = await request('/eventos');

    if (!resultado.ok) {
        lista.innerHTML = '<p class="muted">No se pudieron cargar los eventos.</p>';
        return;
    }

    const eventos = Array.isArray(resultado.data) ? resultado.data : [];

    if (!eventos.length) {
        lista.innerHTML = '<p class="muted">No hay eventos disponibles.</p>';
        return;
    }

    lista.innerHTML = eventos.map(evento => `
        <article class="card">
            <div class="card-body">
                <span class="badge">${escapeHtml(formatTipo(evento.tipo))}</span>
                <h3>${escapeHtml(evento.nombre)}</h3>
                <p>${escapeHtml(evento.fecha)} · ${escapeHtml(String(evento.hora || '').slice(0, 5))}</p>
                <p>${escapeHtml(evento.cancha || '')}</p>
                <p>${escapeHtml(evento.descripcion || '')}</p>
                <strong>${escapeHtml(evento.cupos)} cupos · ${escapeHtml(evento.estado)}</strong>
            </div>
        </article>
    `).join('');
}

/* =========================================================
   PERFIL DEL USUARIO
   ========================================================= */
function toggleProfile() {
    $('profile-edit').classList.toggle('hidden');
}

async function cargarPanel() {
    if (!user) return;
    if (user.rol === 'ADMIN') {
        view('admin');
        return;
    }

    $('profile-title').textContent = `${user.nombre || ''} ${user.apellido || ''}`.trim();
    $('profile-email').textContent = user.email || '';
    $('p-nombre').value = user.nombre || '';
    $('p-apellido').value = user.apellido || '';
    $('p-celular').value = user.celular || '';
    $('p-email').value = user.email || '';
    $('p-ci').value = user.ci || '';

    const resultado = await request(`/reservas?usuario_id=${user.id}`);
    const reservas = resultado.ok && Array.isArray(resultado.data) ? resultado.data : [];

    if (!reservas.length) {
        $('reservation-list').innerHTML = '<p class="muted">Todavía no tenés reservas.</p>';
        return;
    }

    $('reservation-list').innerHTML = reservas.map(reserva => `
        <div class="reservation">
            <div class="info">
                <strong>${escapeHtml(reserva.cancha)}</strong>
                <div class="muted">
                    ${escapeHtml(formatTipo(reserva.tipo))} ·
                    ${escapeHtml(reserva.fecha)} ·
                    ${escapeHtml(String(reserva.hora || '').slice(0, 5))}
                </div>
            </div>
            <span class="status">${escapeHtml(reserva.estado)}</span>
            ${['ACTIVA', 'ACEPTADA'].includes(reserva.estado)
                ? `<button class="danger" onclick="cancel(${Number(reserva.id)})">Cancelar</button>`
                : ''}
        </div>
    `).join('');
}

async function saveProfile() {
    const resultado = await request(`/usuarios/${user.id}/perfil`, {
        method: 'PUT',
        body: JSON.stringify({
            nombre: $('p-nombre').value.trim(),
            apellido: $('p-apellido').value.trim(),
            celular: $('p-celular').value.trim(),
            email: $('p-email').value.trim()
        })
    });

    if (!resultado.ok) {
        mostrarMensaje('profile-msg', resultado.error || 'No se pudieron guardar los datos.');
        return;
    }

    user = resultado.user;
    $('hello').textContent = `Hola, ${user.nombre}`;
    mostrarMensaje('profile-msg', 'Datos actualizados correctamente.', true);
    cargarPanel();
}

async function changePassword() {
    const resultado = await request(`/usuarios/${user.id}/password`, {
        method: 'PUT',
        body: JSON.stringify({
            actual: $('old-pass').value,
            nueva: $('new-pass').value,
            confirmacion: $('confirm-pass').value
        })
    });

    if (!resultado.ok) {
        mostrarMensaje('pass-msg', resultado.error || 'No se pudo actualizar la contraseña.');
        return;
    }

    $('old-pass').value = '';
    $('new-pass').value = '';
    $('confirm-pass').value = '';
    mostrarMensaje('pass-msg', 'Contraseña actualizada correctamente.', true);
}

async function cancel(id) {
    if (!confirm('¿Estás seguro de que querés cancelar esta reserva?')) return;

    const resultado = await request(`/reservas/${id}`, { method: 'DELETE' });
    if (!resultado.ok) {
        alert(resultado.error || 'No se pudo cancelar la reserva.');
        return;
    }
    cargarPanel();
}

/* =========================================================
   ADMINISTRACIÓN
   ========================================================= */
async function cargarAdmin() {
    if (!user || user.rol !== 'ADMIN') {
        $('admin-denied').classList.remove('hidden');
        $('admin-content').classList.add('hidden');
        return;
    }

    $('admin-denied').classList.add('hidden');
    $('admin-content').classList.remove('hidden');

    const resultado = await request('/admin/stats');
    if (resultado.ok) {
        const stats = resultado.data || {};
        $('stats').innerHTML = `
            <div class="stat"><strong>${stats.usuarios || 0}</strong><span>Usuarios</span></div>
            <div class="stat"><strong>${stats.canchas || 0}</strong><span>Canchas activas</span></div>
            <div class="stat"><strong>${stats.reservas || 0}</strong><span>Reservas activas</span></div>
            <div class="stat"><strong>${stats.eventos || 0}</strong><span>Eventos abiertos</span></div>
        `;
    }

    await Promise.all([
        cargarAdminCanchas(),
        cargarAdminEventos(),
        cargarUsuariosAdmin(),
        cargarReservasAdmin()
    ]);
    adminTab('canchas');
}

function adminTab(tab) {
    ['canchas', 'eventos', 'usuarios', 'reservas', 'reportes'].forEach(item => {
        $(`a-${item}`).classList.toggle('hidden', item !== tab);
    });
}

async function cargarAdminCanchas() {
    const resultado = await request('/admin/canchas');
    if (!resultado.ok) return;
    const data = Array.isArray(resultado.data) ? resultado.data : [];

    $('admin-canchas').innerHTML = data.map(cancha => `
        <article class="card">
            <img src="${escapeHtml(cancha.imagen_url || '')}" alt="${escapeHtml(cancha.nombre)}">
            <div class="card-body">
                <span class="badge">${escapeHtml(formatTipo(cancha.tipo))}</span>
                <h3>${escapeHtml(cancha.nombre)}</h3>
                <p>${escapeHtml(cancha.descripcion || '')}</p>
                <p><strong>${escapeHtml(formatDinero(cancha.precio_hora))}/h</strong> · ${cancha.activa ? 'Activa' : 'Inactiva'}</p>
                <button class="edit" onclick='openCancha(${JSON.stringify(cancha)})'>Editar</button>
            </div>
        </article>
    `).join('');
}

function openCancha(cancha = null) {
    const editando = Boolean(cancha);
    abrirModal(`
        <h2>${editando ? 'Editar cancha' : 'Nueva cancha'}</h2>
        <input id="c-id" type="hidden" value="${editando ? Number(cancha.id) : ''}">
        <label>Nombre</label>
        <input id="c-name" value="${editando ? escapeHtml(cancha.nombre) : ''}">
        <label>Tipo</label>
        <select id="c-type">
            <option value="FUTBOL5">Fútbol 5</option>
            <option value="FUTBOL7">Fútbol 7</option>
        </select>
        <label>Descripción</label>
        <textarea id="c-desc">${editando ? escapeHtml(cancha.descripcion || '') : ''}</textarea>
        <label>Precio por hora</label>
        <input id="c-price" type="number" value="${editando ? Number(cancha.precio_hora) : ''}">
        <label>URL de imagen</label>
        <input id="c-img" value="${editando ? escapeHtml(cancha.imagen_url || '') : ''}">
        <label><input id="c-active" type="checkbox" style="width:auto" ${!editando || cancha.activa ? 'checked' : ''}> Cancha activa</label>
        <br><br>
        <button class="primary" onclick="saveCancha()">Guardar cambios</button>
        ${editando ? `<button class="danger" onclick="deleteCancha(${Number(cancha.id)})">Eliminar</button>` : ''}
        <p id="c-msg"></p>
    `);
    if (editando) $('c-type').value = cancha.tipo;
}

async function saveCancha() {
    const id = $('c-id').value;
    const datos = {
        nombre: $('c-name').value.trim(),
        tipo: $('c-type').value,
        descripcion: $('c-desc').value.trim(),
        precio_hora: $('c-price').value,
        imagen_url: $('c-img').value.trim(),
        activa: $('c-active').checked
    };

    const resultado = await request(id ? `/admin/canchas/${id}` : '/admin/canchas', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(datos)
    });

    if (!resultado.ok) {
        mostrarMensaje('c-msg', resultado.error || 'No se pudo guardar la cancha.');
        return;
    }

    closeModal();
    cargarAdminCanchas();
}

async function deleteCancha(id) {
    if (!confirm('¿Deseás eliminar esta cancha?')) return;
    const resultado = await request(`/admin/canchas/${id}`, { method: 'DELETE' });
    if (!resultado.ok) {
        alert(resultado.error || 'No se pudo eliminar.');
        return;
    }
    closeModal();
    cargarAdminCanchas();
}

async function cargarAdminEventos() {
    const resultado = await request('/admin/eventos');
    if (!resultado.ok) return;
    const data = Array.isArray(resultado.data) ? resultado.data : [];

    $('admin-eventos').innerHTML = `
        <div class="tablebox">
            <table><thead><tr><th>Evento</th><th>Fecha</th><th>Hora</th><th>Cancha</th><th>Estado</th><th>Editar</th></tr></thead>
            <tbody>${data.map(evento => `
                <tr>
                    <td>${escapeHtml(evento.nombre)}</td>
                    <td>${escapeHtml(evento.fecha)}</td>
                    <td>${escapeHtml(String(evento.hora || '').slice(0, 5))}</td>
                    <td>${escapeHtml(evento.cancha)}</td>
                    <td>${escapeHtml(evento.estado)}</td>
                    <td><button class="edit" onclick='openEvento(${JSON.stringify(evento)})'>Editar</button></td>
                </tr>
            `).join('')}</tbody></table>
        </div>
    `;
}

async function openEvento(evento = null) {
    if (!canchas.length) {
        const resultado = await request('/canchas');
        if (resultado.ok) canchas = resultado.data || [];
    }

    const editando = Boolean(evento);
    const opciones = canchas.map(cancha => `<option value="${Number(cancha.id)}">${escapeHtml(cancha.nombre)}</option>`).join('');

    abrirModal(`
        <h2>${editando ? 'Editar evento' : 'Crear evento'}</h2>
        <input id="e-id" type="hidden" value="${editando ? Number(evento.id) : ''}">
        <label>Nombre</label><input id="e-name" value="${editando ? escapeHtml(evento.nombre) : ''}">
        <div class="twocol">
            <div><label>Fecha</label><input id="e-date" type="date" value="${editando ? escapeHtml(evento.fecha) : ''}"></div>
            <div><label>Hora</label><input id="e-hour" type="time" value="${editando ? escapeHtml(String(evento.hora || '').slice(0, 5)) : ''}"></div>
        </div>
        <label>Tipo</label>
        <select id="e-type"><option value="FUTBOL5">Fútbol 5</option><option value="FUTBOL7">Fútbol 7</option></select>
        <label>Cancha</label><select id="e-court">${opciones}</select>
        <label>Cupos</label><input id="e-slots" type="number" value="${editando ? Number(evento.cupos) : ''}">
        <label>Descripción</label><textarea id="e-desc">${editando ? escapeHtml(evento.descripcion || '') : ''}</textarea>
        <label>Estado</label>
        <select id="e-state"><option value="ABIERTO">ABIERTO</option><option value="CERRADO">CERRADO</option><option value="CANCELADO">CANCELADO</option></select>
        <button class="primary" onclick="saveEvento()">Guardar evento</button>
        ${editando ? `<button class="danger" onclick="deleteEvento(${Number(evento.id)})">Eliminar</button>` : ''}
        <p id="e-msg"></p>
    `);

    if (editando) {
        $('e-type').value = evento.tipo;
        $('e-court').value = evento.cancha_id;
        $('e-state').value = evento.estado;
    }
}

async function saveEvento() {
    const id = $('e-id').value;
    const datos = {
        nombre: $('e-name').value.trim(),
        fecha: $('e-date').value,
        hora: $('e-hour').value,
        tipo: $('e-type').value,
        cancha_id: $('e-court').value,
        cupos: $('e-slots').value,
        descripcion: $('e-desc').value.trim(),
        estado: $('e-state').value
    };

    const resultado = await request(id ? `/admin/eventos/${id}` : '/admin/eventos', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(datos)
    });

    if (!resultado.ok) {
        mostrarMensaje('e-msg', resultado.error || 'No se pudo guardar el evento.');
        return;
    }

    closeModal();
    cargarAdminEventos();
}

async function deleteEvento(id) {
    if (!confirm('¿Deseás eliminar este evento?')) return;
    const resultado = await request(`/admin/eventos/${id}`, { method: 'DELETE' });
    if (!resultado.ok) {
        alert(resultado.error || 'No se pudo eliminar.');
        return;
    }
    closeModal();
    cargarAdminEventos();
}

async function cargarUsuariosAdmin(busqueda = '') {
    const resultado = await request(`/admin/usuarios?q=${encodeURIComponent(busqueda)}`);
    if (!resultado.ok) return;
    const data = Array.isArray(resultado.data) ? resultado.data : [];

    $('admin-users').innerHTML = `
        <table><thead><tr><th>Nombre</th><th>Correo</th><th>Celular</th><th>CI</th><th>Rol</th><th>Estado</th><th>Editar</th></tr></thead>
        <tbody>${data.map(usuario => `
            <tr>
                <td>${escapeHtml(usuario.nombre)} ${escapeHtml(usuario.apellido)}</td>
                <td>${escapeHtml(usuario.email)}</td>
                <td>${escapeHtml(usuario.celular)}</td>
                <td>${escapeHtml(usuario.ci)}</td>
                <td>${escapeHtml(usuario.rol)}</td>
                <td>${usuario.activo ? 'Activo' : 'Inactivo'}</td>
                <td><button class="edit" onclick='openUser(${JSON.stringify(usuario)})'>Editar</button></td>
            </tr>
        `).join('')}</tbody></table>
    `;
}

function searchUsers() {
    cargarUsuariosAdmin($('user-search').value);
}

function openUser(usuario) {
    abrirModal(`
        <h2>Editar usuario</h2>
        <input id="u-id" type="hidden" value="${Number(usuario.id)}">
        <div class="twocol">
            <div><label>Nombre</label><input id="u-name" value="${escapeHtml(usuario.nombre)}"></div>
            <div><label>Apellido</label><input id="u-last" value="${escapeHtml(usuario.apellido)}"></div>
        </div>
        <label>Correo</label><input id="u-email" value="${escapeHtml(usuario.email)}">
        <label>Celular</label><input id="u-cell" value="${escapeHtml(usuario.celular)}">
        <label>CI</label><input id="u-ci" value="${escapeHtml(usuario.ci)}">
        <label>Rol</label><select id="u-role"><option value="USUARIO">Usuario</option><option value="ADMIN">Administrador</option></select>
        <label><input id="u-active" type="checkbox" style="width:auto" ${usuario.activo ? 'checked' : ''}> Cuenta activa</label>
        <br><br><button class="primary" onclick="saveUser()">Guardar cambios</button>
        <p id="u-msg"></p>
    `);
    $('u-role').value = usuario.rol;
}

async function saveUser() {
    const id = $('u-id').value;
    const resultado = await request(`/admin/usuarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
            nombre: $('u-name').value.trim(),
            apellido: $('u-last').value.trim(),
            email: $('u-email').value.trim(),
            celular: $('u-cell').value.trim(),
            ci: $('u-ci').value.trim(),
            rol: $('u-role').value,
            activo: $('u-active').checked
        })
    });

    if (!resultado.ok) {
        mostrarMensaje('u-msg', resultado.error || 'No se pudo guardar el usuario.');
        return;
    }

    closeModal();
    cargarUsuariosAdmin();
}

async function cargarReservasAdmin() {
    const resultado = await request('/admin/reservas');
    if (!resultado.ok) return;
    const data = Array.isArray(resultado.data) ? resultado.data : [];

    $('admin-reservas').innerHTML = `
        <table><thead><tr><th>Usuario</th><th>Cancha</th><th>Fecha</th><th>Hora</th><th>Estado</th><th>Modificar</th></tr></thead>
        <tbody>${data.map(reserva => `
            <tr>
                <td>${escapeHtml(reserva.usuario)}</td>
                <td>${escapeHtml(reserva.cancha)}</td>
                <td>${escapeHtml(reserva.fecha)}</td>
                <td>${escapeHtml(String(reserva.hora || '').slice(0, 5))}</td>
                <td>${escapeHtml(reserva.estado)}</td>
                <td>
                    <select onchange="stateRes(${Number(reserva.id)}, this.value)">
                        <option value="">Cambiar estado</option>
                        <option value="ACTIVA">ACTIVA</option>
                        <option value="ACEPTADA">ACEPTADA</option>
                        <option value="CANCELADA">CANCELADA</option>
                        <option value="COMPLETADA">COMPLETADA</option>
                    </select>
                </td>
            </tr>
        `).join('')}</tbody></table>
    `;
}

async function stateRes(id, estado) {
    if (!estado) return;
    const resultado = await request(`/admin/reservas/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ estado })
    });
    if (!resultado.ok) {
        alert(resultado.error || 'No se pudo modificar la reserva.');
        return;
    }
    cargarReservasAdmin();
}

function reportPDF() {
    const desde = $('report-from').value;
    const hasta = $('report-to').value;

    if (!desde || !hasta) {
        alert('Seleccioná una fecha desde y una fecha hasta.');
        return;
    }

    window.open(`${API}/admin/reportes/pdf?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`, '_blank');
}
