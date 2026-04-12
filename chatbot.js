/**
 * GRUPO PACC - Chatbot Client
 * Modular architecture with improved error handling
 */

const APP = (() => {
    'use strict';

    // ===== CONFIGURATION =====
    const CONFIG = {
        apiUrl: ENV.API_URL,
        apiDuplicado: ENV.API_DUPLICADO,
        apiWallet: ENV.API_WALLET,
        eclienteUrl: ENV.ECLIENTE_URL,
        sessionDuration: 2 * 60 * 60 * 1000, // 2 hours
        headers: {
            'Content-Type': 'application/json',
            'Empresa': 'pacc',
            'Device': 'web'
        }
    };

    // ===== RESPONSE CACHE =====
    const Cache = {
        _store: new Map(),
        _maxSize: 50,          // máximo de entradas
        _ttl: 5 * 60 * 1000,  // 5 minutos de validez

        /**
         * Genera una clave normalizada a partir del texto de consulta.
         * Elimina espacios extra, signos y pasa a minúsculas.
         */
        _key(text) {
            return text.trim().toLowerCase()
                .replace(/[¿?¡!.,;:]/g, '')
                .replace(/\s+/g, ' ');
        },

        /**
         * Busca en caché. Devuelve el objeto {message, function} o null.
         */
        get(text) {
            const key = this._key(text);
            const entry = this._store.get(key);
            if (!entry) return null;

            // Comprobar TTL
            if (Date.now() - entry.timestamp > this._ttl) {
                this._store.delete(key);
                return null;
            }

            return entry.data;
        },

        /**
         * Guarda una respuesta en caché.
         * Solo cachea respuestas de consultas de datos (no solicitudes ni errores).
         */
        set(text, data) {
            // No cachear errores ni respuestas vacías
            if (!data || !data.message || data.error) return;

            const key = this._key(text);

            // Si el caché está lleno, eliminar la entrada más antigua
            if (this._store.size >= this._maxSize) {
                const oldestKey = this._store.keys().next().value;
                this._store.delete(oldestKey);
            }

            this._store.set(key, {
                data: { message: data.message, function: data.function },
                timestamp: Date.now()
            });
        },

        /** Limpia todo el caché (al hacer logout, por ejemplo) */
        clear() {
            this._store.clear();
        }
    };

    // ===== AUTOCOMPLETE MODULE =====
    const Autocomplete = {
        _suggestions: [
            { icon: 'bi-file-earmark-text', text: '¿Qué pólizas tengo?', keywords: ['poliza', 'polizas', 'seguro', 'seguros', 'contrato'] },
            { icon: 'bi-cash-coin',         text: '¿Cuánto pago por mis seguros?', keywords: ['pago', 'pagar', 'cuanto', 'precio', 'prima', 'coste', 'recibo'] },
            { icon: 'bi-calendar-check',    text: '¿Cuáles son mis próximos recibos?', keywords: ['proximo', 'recibo', 'vencimiento', 'renovar', 'renovacion'] },
            { icon: 'bi-telephone',         text: 'Teléfonos de asistencia', keywords: ['telefono', 'llamar', 'asistencia', 'contacto', 'atencion'] },
            { icon: 'bi-geo-alt',           text: '¿Cuál es mi oficina?', keywords: ['oficina', 'donde', 'direccion', 'ubicacion', 'sucursal'] },
            { icon: 'bi-person-lines-fill', text: '¿Cuáles son mis datos personales?', keywords: ['datos', 'personal', 'mis datos', 'nombre', 'direccion', 'email'] },
            { icon: 'bi-exclamation-triangle', text: '¿Qué siniestros tengo abiertos?', keywords: ['siniestro', 'accidente', 'parte', 'dano', 'averia'] },
            { icon: 'bi-plus-circle',       text: 'Quiero dar de alta un siniestro', keywords: ['alta', 'nuevo', 'abrir', 'declarar', 'siniestro', 'parte'] },
            { icon: 'bi-pencil-square',     text: 'Quiero solicitar un cambio en mi póliza', keywords: ['cambio', 'modificar', 'cambiar', 'actualizar', 'solicitar'] },
            { icon: 'bi-file-earmark-arrow-down', text: 'Quiero un duplicado de mi póliza', keywords: ['duplicado', 'copia', 'descargar', 'documento', 'pdf'] },
            { icon: 'bi-wallet2',           text: 'Quiero la tarjeta wallet de mi póliza', keywords: ['wallet', 'tarjeta', 'cartera', 'movil', 'apple', 'google'] },
            { icon: 'bi-x-circle',          text: 'Quiero anular una póliza', keywords: ['anular', 'cancelar', 'baja', 'dar de baja'] },
        ],

        _el: null,         // dropdown element
        _selected: -1,     // currently highlighted index
        _visible: [],      // currently visible filtered items
        _composing: false, // IME composition in progress (Android keyboards)

        init() {
            // Create dropdown container
            this._el = document.createElement('div');
            this._el.className = 'autocomplete-dropdown hidden';
            this._el.id = 'autocomplete-dropdown';
            // Insert before the input wrapper (inside chat-input-area footer)
            const inputArea = DOM.chatInput.closest('.chat-input-area');
            inputArea.insertBefore(this._el, inputArea.firstChild);

            // IME composition events (Android predictive keyboards)
            DOM.chatInput.addEventListener('compositionstart', () => { this._composing = true; });
            DOM.chatInput.addEventListener('compositionend', () => {
                this._composing = false;
                this._onInput(); // Process after composition finishes
            });

            // Input events
            DOM.chatInput.addEventListener('input', () => {
                if (!this._composing) this._onInput();
            });
            DOM.chatInput.addEventListener('keydown', (e) => this._onKeydown(e));
            DOM.chatInput.addEventListener('blur', () => {
                // Longer delay on mobile to allow tap on item
                setTimeout(() => this.hide(), 300);
            });
            DOM.chatInput.addEventListener('focus', () => {
                if (DOM.chatInput.value.trim().length >= 2) this._onInput();
            });
        },

        _normalize(text) {
            return text.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[¿?¡!.,;:]/g, '')
                .trim();
        },

        _onInput() {
            const raw = DOM.chatInput.value.trim();
            if (raw.length < 2) { this.hide(); return; }

            const query = this._normalize(raw);
            const words = query.split(/\s+/);

            // Score each suggestion
            const scored = this._suggestions.map(s => {
                let score = 0;
                const normalText = this._normalize(s.text);

                // Direct text match (highest)
                if (normalText.includes(query)) score += 10;

                // Keyword matches
                for (const word of words) {
                    if (word.length < 2) continue;
                    for (const kw of s.keywords) {
                        if (kw.includes(word) || word.includes(kw)) score += 3;
                    }
                    if (normalText.includes(word)) score += 2;
                }
                return { ...s, score };
            })
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

            if (scored.length === 0) { this.hide(); return; }

            this._visible = scored;
            this._selected = -1;
            this._render();
        },

        _render() {
            this._el.innerHTML = '';
            this._visible.forEach((item, i) => {
                const div = document.createElement('div');
                div.className = 'autocomplete-item' + (i === this._selected ? ' selected' : '');
                div.innerHTML = `<i class="bi ${item.icon}"></i><span>${item.text}</span>`;
                div.addEventListener('pointerdown', (e) => {
                    e.preventDefault(); // prevent blur on mobile & desktop
                    this._select(i);
                });
                div.addEventListener('mouseenter', () => {
                    this._selected = i;
                    this._highlightSelected();
                });
                this._el.appendChild(div);
            });
            this._el.classList.remove('hidden');
        },

        _highlightSelected() {
            this._el.querySelectorAll('.autocomplete-item').forEach((el, i) => {
                el.classList.toggle('selected', i === this._selected);
            });
        },

        _onKeydown(e) {
            if (this._el.classList.contains('hidden') || this._visible.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._selected = Math.min(this._selected + 1, this._visible.length - 1);
                this._highlightSelected();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._selected = Math.max(this._selected - 1, 0);
                this._highlightSelected();
            } else if (e.key === 'Enter' && this._selected >= 0) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._select(this._selected);
            } else if (e.key === 'Escape') {
                this.hide();
            }
        },

        _select(index) {
            const item = this._visible[index];
            if (!item) return;
            DOM.chatInput.value = item.text;
            this.hide();
            DOM.chatInput.focus();
            // Auto-send
            Chat.send(item.text);
        },

        hide() {
            this._el.classList.add('hidden');
            this._selected = -1;
            this._visible = [];
        }
    };

    // ===== DOM CACHE =====
    const DOM = {};

    function cacheDom() {
        DOM.loginScreen    = document.getElementById('login-screen');
        DOM.chatScreen     = document.getElementById('chat-screen');
        DOM.loginForm      = document.getElementById('user-data-form');
        DOM.nifInput       = document.getElementById('nif');
        DOM.movilInput     = document.getElementById('movil');
        DOM.submitBtn      = document.getElementById('submitButton');
        DOM.buttonText     = document.getElementById('buttonText');
        DOM.spinner        = document.getElementById('spinner');
        DOM.apiErrors      = document.getElementById('api-errors');
        DOM.otpForm        = document.getElementById('otp-form');
        DOM.otpCode        = document.getElementById('otp-code');
        DOM.otpErrors      = document.getElementById('otp-errors');
        DOM.otpSubtitle    = document.getElementById('otp-subtitle');
        DOM.otpSubmitBtn   = document.getElementById('otpSubmitButton');
        DOM.otpButtonText  = document.getElementById('otpButtonText');
        DOM.otpSpinner     = document.getElementById('otpSpinner');
        DOM.otpBack        = document.getElementById('otp-back');
        DOM.chatBox        = document.getElementById('chat-box');
        DOM.chatForm       = document.getElementById('chat-form');
        DOM.chatInput      = document.getElementById('chat-message');
        DOM.quickActions    = document.getElementById('quick-actions');
        DOM.logoutBtn      = document.getElementById('btn-logout');
        DOM.toastContainer = document.getElementById('toast-container');
        DOM.userBadge      = document.getElementById('user-badge');
        DOM.userInitials   = document.getElementById('user-initials');
        DOM.userName       = document.getElementById('user-name');
        DOM.btnMic         = document.getElementById('btn-mic');
        DOM.recordingIndicator = document.getElementById('recording-indicator');
        DOM.recordingTimer = document.getElementById('recording-timer');
        DOM.btnTheme       = document.getElementById('btn-theme');
        DOM.btnFeatures    = document.getElementById('btn-features');
        DOM.btnClearChat   = document.getElementById('btn-clear-chat');
        DOM.btnEcliente    = document.getElementById('btn-ecliente');
        DOM.btnAvatarMenu  = document.getElementById('btn-avatar-menu');
        DOM.avatarDropdown = document.getElementById('avatar-dropdown');
        DOM.featuresModal  = document.getElementById('features-modal');
        DOM.featuresClose  = document.getElementById('features-modal-close');
        DOM.btnScrollDown  = document.getElementById('btn-scroll-down');
        DOM.btnInstallPwa  = document.getElementById('btn-install-pwa');
    }

    // ===== SESSION MODULE =====
    const Session = {
        _token: null,
        _nombre: null,

        get token() {
            return this._token;
        },

        get nombre() {
            return this._nombre;
        },

        init() {
            try {
                const token  = localStorage.getItem('userToken');
                const expiry = parseInt(localStorage.getItem('userTokenExpiry'), 10);
                const nombre = localStorage.getItem('userName');
                if (token && expiry && expiry > Date.now()) {
                    this._token = token;
                    this._nombre = nombre;
                    return true;
                }
            } catch { /* private browsing */ }
            this.clear();
            return false;
        },

        save(token, nombre) {
            this._token = token;
            this._nombre = nombre || null;
            try {
                localStorage.setItem('userToken', token);
                localStorage.setItem('userTokenExpiry', (Date.now() + CONFIG.sessionDuration).toString());
                if (nombre) localStorage.setItem('userName', nombre);
            } catch { /* private browsing */ }
        },

        clear() {
            this._token = null;
            this._nombre = null;
            try {
                localStorage.removeItem('userToken');
                localStorage.removeItem('userTokenExpiry');
                localStorage.removeItem('userName');
                localStorage.removeItem('userNif');
                localStorage.removeItem('userMovil');
            } catch { /* ignore */ }
        },

        getAuthHeaders() {
            return {
                ...CONFIG.headers,
                'Authorization': `Bearer ${this._token}`
            };
        }
    };

    // ===== UI MODULE =====
    const UI = {
        showScreen(name) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            const target = name === 'login' ? DOM.loginScreen : DOM.chatScreen;
            target.classList.add('active');
            if (name === 'chat') {
                DOM.chatInput.focus();
            }
        },

        setLoginLoading(loading) {
            DOM.spinner.classList.toggle('hidden', !loading);
            DOM.buttonText.textContent = loading ? 'Verificando...' : 'Entrar';
            DOM.submitBtn.disabled = loading;
        },

        showLoginError(msg) {
            DOM.apiErrors.textContent = msg;
            DOM.apiErrors.classList.remove('hidden');
        },

        clearLoginError() {
            DOM.apiErrors.classList.add('hidden');
        },

        showUserBadge(nombre) {
            if (!nombre) {
                DOM.userBadge.classList.add('hidden');
                return;
            }
            // "GARCIA LOPEZ, JUAN PEDRO" -> display "Juan G.L."
            // "JUAN PEDRO GARCIA LOPEZ" -> display "Juan P.G."
            const parts = nombre.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
            let displayName = nombre;
            let initials = '';

            if (nombre.includes(',')) {
                // Formato: "APELLIDO1 APELLIDO2, NOMBRE NOMBRE2"
                const [apellidos, nombres] = nombre.split(',').map(s => s.trim());
                const aParts = apellidos.split(/\s+/);
                const nParts = nombres.split(/\s+/);
                const firstName = nParts[0] || '';
                displayName = this._capitalize(firstName) + ' ' + aParts.map(a => a[0] + '.').join('');
                initials = (firstName[0] || '') + (aParts[0]?.[0] || '');
            } else {
                // Formato: "NOMBRE APELLIDO1 APELLIDO2"
                if (parts.length >= 2) {
                    const firstName = parts[0];
                    const rest = parts.slice(1);
                    displayName = this._capitalize(firstName) + ' ' + rest.map(a => a[0] + '.').join('');
                    initials = firstName[0] + (rest[0]?.[0] || '');
                } else {
                    displayName = this._capitalize(parts[0] || '');
                    initials = (parts[0]?.[0] || '').toUpperCase();
                }
            }

            DOM.userInitials.textContent = initials.toUpperCase();
            DOM.userName.textContent = displayName;
            DOM.userBadge.classList.remove('hidden');
        },

        _capitalize(str) {
            return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
        },

        toast(message, type = 'error') {
            const icons = { error: 'bi-wifi-off', success: 'bi-check-circle', warning: 'bi-exclamation-triangle' };
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `<i class="bi ${icons[type] || icons.error}"></i><span>${message}</span>`;
            DOM.toastContainer.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(40px)';
                toast.style.transition = '0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 4000);
        }
    };

    // ===== CHAT MODULE =====
    const Chat = {
        _quickActionsVisible: true,

        _formatMarkdown(text) {
            // Si ya contiene HTML de nuestras cards, no tocar
            if (text.includes('cb-data-') || text.includes('cb-results') || text.includes('cb-pagos-') || text.includes('cb-telefonos') || text.includes('cb-solicitud') || text.includes('cb-poliza-selector') || text.includes('cb-action-')) {
                // Solo parsear la parte de texto fuera de las tags HTML
                return text.replace(/^([^<]+)/, (match) => this._mdToHtml(match));
            }
            return this._mdToHtml(text);
        },

        _mdToHtml(text) {
            // Headers
            let html = text
                .replace(/^### (.+)$/gm, '<strong style="font-size:1.05em">$1</strong>')
                .replace(/^## (.+)$/gm, '<strong style="font-size:1.1em">$1</strong>');
            // Bold / italic
            html = html
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>');
            // Listas con - o *
            html = html.replace(/(^|\n)([*\-] .+(?:\n[*\-] .+)*)/g, (match, pre, list) => {
                const items = list.split('\n').map(l => `<li>${l.replace(/^[*\-] /, '')}</li>`).join('');
                return `${pre}<ul style="margin:4px 0 4px 16px;padding:0">${items}</ul>`;
            });
            // Listas numeradas
            html = html.replace(/(^|\n)(\d+\. .+(?:\n\d+\. .+)*)/g, (match, pre, list) => {
                const items = list.split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
                return `${pre}<ol style="margin:4px 0 4px 16px;padding:0">${items}</ol>`;
            });
            // Saltos de línea
            html = html.replace(/\n/g, '<br>');
            return html;
        },

        addMessage(type, html) {
            const wrapper = document.createElement('div');
            wrapper.className = `message ${type}`;

            const content = document.createElement('div');
            content.className = 'message-content';
            content.innerHTML = type === 'bot' ? this._formatMarkdown(html) : html;

            // Botón de voz en mensajes del bot (solo si tiene texto útil)
            if (type === 'bot' && window.speechSynthesis) {
                const textContent = content.textContent.trim();
                if (textContent.length > 5) {
                    const ttsBtn = document.createElement('button');
                    ttsBtn.className = 'btn-tts';
                    ttsBtn.title = 'Escuchar';
                    ttsBtn.innerHTML = '<i class="bi bi-volume-up-fill"></i>';
                    ttsBtn.addEventListener('click', () => TTS.speak(textContent, ttsBtn));
                    content.appendChild(ttsBtn);
                }
            }

            // Hora del mensaje estilo WhatsApp
            const time = document.createElement('span');
            time.className = 'message-time';
            const now = new Date();
            time.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            content.appendChild(time);

            wrapper.appendChild(content);
            DOM.chatBox.appendChild(wrapper);
            Scroll.auto();

            // Hide quick actions after first user message
            if (type === 'user' && this._quickActionsVisible) {
                this._quickActionsVisible = false;
                DOM.quickActions.style.display = 'none';
            }

            return wrapper;
        },

        showThinking() {
            const wrapper = document.createElement('div');
            wrapper.className = 'message bot thinking';
            wrapper.innerHTML = `
                <div class="message-content">
                    <div class="typing-indicator">
                        <div class="typing-dots">
                            <span class="dot"></span>
                            <span class="dot"></span>
                            <span class="dot"></span>
                        </div>
                        <span class="typing-text">PACCMAN est\u00e1 escribiendo</span>
                    </div>
                </div>`;
            DOM.chatBox.appendChild(wrapper);
            Scroll.toBottom();
        },

        removeThinking() {
            DOM.chatBox.querySelectorAll('.thinking').forEach(el => el.remove());
        },

        async send(text) {
            if (!text.trim()) return;

            this.addMessage('user', this._escapeHtml(text));
            DOM.chatInput.value = '';
            Autocomplete.hide();
            DOM.chatInput.focus();

            // Comprobar caché: respuesta instantánea si ya la tenemos
            const cached = Cache.get(text);
            if (cached) {
                const msgEl = this.addMessage('bot', cached.message);
                // Sugerencias rápidas desactivadas
                // this._showSuggestions(msgEl, cached.function, cached.message, text);
                return;
            }

            this.showThinking();

            try {
                const res = await fetch(`${CONFIG.apiUrl}/consulta`, {
                    method: 'POST',
                    headers: Session.getAuthHeaders(),
                    body: JSON.stringify({ consulta: text })
                });

                this.removeThinking();

                if (res.status === 401) {
                    Session.clear();
                    UI.toast('Tu sesion ha expirado. Inicia sesion de nuevo.', 'warning');
                    setTimeout(() => UI.showScreen('login'), 1500);
                    return;
                }

                const data = await res.json();

                if (res.ok && data.message) {
                    // Guardar en caché para próximas consultas idénticas
                    Cache.set(text, data);
                    const msgEl = this.addMessage('bot', data.message);

                    // Indicador de urgencia/frustración detectada
                    if (data.urgency === 'critical' || data.urgency === 'high') {
                        msgEl.querySelector('.message-content')?.classList.add('msg-urgent');
                    }
                    if (data.frustration === 'high') {
                        msgEl.querySelector('.message-content')?.classList.add('msg-empathic');
                    }
                } else {
                    this.addMessage('bot', data.error || 'Lo siento, no he podido procesar tu consulta. Intentalo de nuevo.');
                }
            } catch (err) {
                this.removeThinking();
                this.addMessage('bot', '<i class="bi bi-wifi-off"></i> No se pudo conectar con el servidor. Comprueba tu conexion.');
                UI.toast('Error de conexion con el servidor', 'error');
                console.error('[Chat Error]', err);
            }
        },

        _getSuggestions(fn, botText, userText) {
            const fnName = fn?.name || null;

            // Si no hay función, intentar detectar contexto por texto
            if (!fnName && (botText || userText)) {
                const combined = ((userText || '') + ' ' + (botText || '')).toLowerCase();
                const siniestroKw = ['siniestro', 'accidente', 'grúa', 'grua', 'avería', 'averia', 'robo', 'incendio', 'inundación', 'inundacion', 'tirado', 'choque', 'golpe'];
                const isSiniestro = siniestroKw.some(kw => combined.includes(kw));
                if (isSiniestro) {
                    return [
                        { icon: 'bi-telephone', label: 'Telefonos cias', msg: 'Teléfonos de asistencia' },
                        { icon: 'bi-plus-circle', label: 'Abrir siniestro', msg: 'Quiero abrir un siniestro' },
                        { icon: 'bi-exclamation-triangle', label: 'Mis siniestros', msg: '¿Qué siniestros tengo?' }
                    ];
                }
            }

            const map = {
                'consulta_datos':        [
                    { icon: 'bi-cash-coin', label: 'Cuanto pago', msg: '¿Cuánto pago por mis seguros?' },
                    { icon: 'bi-telephone', label: 'Telefonos', msg: 'Teléfonos de asistencia' },
                    { icon: 'bi-pencil-square', label: 'Solicitar cambio', msg: 'Quiero solicitar un cambio en mis datos' }
                ],
                'resumen_pagos':         [
                    { icon: 'bi-calendar-check', label: 'Proximos recibos', msg: '¿Cuáles son mis próximos recibos?' },
                    { icon: 'bi-file-earmark-text', label: 'Mis polizas', msg: '¿Qué pólizas tengo?' },
                    { icon: 'bi-pencil-square', label: 'Solicitar cambio', msg: 'Quiero solicitar un cambio en mi póliza' }
                ],
                'telefonos_companias':   [
                    { icon: 'bi-file-earmark-text', label: 'Mis polizas', msg: '¿Qué pólizas tengo?' },
                    { icon: 'bi-exclamation-triangle', label: 'Mis siniestros', msg: '¿Qué siniestros tengo?' },
                    { icon: 'bi-geo-alt', label: 'Mi oficina', msg: '¿Cuál es mi oficina?' }
                ],
                'datos_contacto_oficina':[
                    { icon: 'bi-telephone', label: 'Telefonos', msg: 'Teléfonos de asistencia' },
                    { icon: 'bi-file-earmark-text', label: 'Mis polizas', msg: '¿Qué pólizas tengo?' },
                    { icon: 'bi-person-lines-fill', label: 'Mis datos', msg: '¿Cuáles son mis datos personales?' }
                ],
                'datos_cliente':         [
                    { icon: 'bi-pencil-square', label: 'Cambiar datos', msg: 'Quiero modificar mis datos personales' },
                    { icon: 'bi-file-earmark-text', label: 'Mis polizas', msg: '¿Qué pólizas tengo?' },
                    { icon: 'bi-cash-coin', label: 'Cuanto pago', msg: '¿Cuánto pago por mis seguros?' }
                ],
                'solicitar_cambio':      [
                    { icon: 'bi-person-lines-fill', label: 'Mis datos', msg: '¿Cuáles son mis datos personales?' },
                    { icon: 'bi-file-earmark-text', label: 'Mis polizas', msg: '¿Qué pólizas tengo?' },
                    { icon: 'bi-geo-alt', label: 'Mi oficina', msg: '¿Cuál es mi oficina?' }
                ],
                'ayuda_siniestro':       [
                    { icon: 'bi-telephone', label: 'Telefonos cias', msg: 'Teléfonos de asistencia' },
                    { icon: 'bi-plus-circle', label: 'Abrir siniestro', msg: 'Quiero abrir un siniestro' },
                    { icon: 'bi-exclamation-triangle', label: 'Mis siniestros', msg: '¿Qué siniestros tengo?' }
                ],
                'nuevo_siniestro':       [
                    { icon: 'bi-telephone', label: 'Telefonos cias', msg: 'Teléfonos de asistencia' },
                    { icon: 'bi-exclamation-triangle', label: 'Mis siniestros', msg: '¿Qué siniestros tengo?' },
                    { icon: 'bi-file-earmark-text', label: 'Mis polizas', msg: '¿Qué pólizas tengo?' }
                ],
                'duplicado_poliza':      [
                    { icon: 'bi-file-earmark-text', label: 'Mis polizas', msg: '¿Qué pólizas tengo?' },
                    { icon: 'bi-cash-coin', label: 'Cuanto pago', msg: '¿Cuánto pago por mis seguros?' },
                    { icon: 'bi-geo-alt', label: 'Mi oficina', msg: '¿Cuál es mi oficina?' }
                ]
            };
            // Default suggestions when no function was called (conversational/conceptual)
            const defaults = [
                { icon: 'bi-file-earmark-text', label: 'Mis polizas', msg: '¿Qué pólizas tengo?' },
                { icon: 'bi-cash-coin', label: 'Cuanto pago', msg: '¿Cuánto pago por mis seguros?' },
                { icon: 'bi-telephone', label: 'Telefonos', msg: 'Teléfonos de asistencia' }
            ];
            return map[fnName] || defaults;
        },

        _showSuggestions(messageEl, fn, botText, userText) {
            // Remove previous suggestions
            DOM.chatBox.querySelectorAll('.cb-suggestions').forEach(el => el.remove());

            const suggestions = this._getSuggestions(fn, botText, userText);
            const container = document.createElement('div');
            container.className = 'cb-suggestions';

            suggestions.forEach(s => {
                const btn = document.createElement('button');
                btn.className = 'cb-suggestion-btn';
                btn.innerHTML = `<i class="bi ${s.icon}"></i> ${s.label}`;
                btn.addEventListener('click', () => {
                    container.remove();
                    Chat.send(s.msg);
                });
                container.appendChild(btn);
            });

            DOM.chatBox.appendChild(container);
            Scroll.auto();
        },

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        /** Carga el historial de conversación al iniciar sesión */
        async loadHistory() {
            try {
                const res = await fetch(`${CONFIG.apiUrl}/history?limit=30`, {
                    headers: {
                        'Authorization': `Bearer ${Session.token}`,
                        'Empresa': CONFIG.headers.Empresa,
                        'Device': CONFIG.headers.Device
                    }
                });

                if (!res.ok) return;
                const data = await res.json();
                if (!data.history || data.history.length === 0) return;

                // Limpiar el chat (quitar mensaje de bienvenida por defecto)
                DOM.chatBox.innerHTML = '';

                let lastDate = null;

                data.history.forEach(msg => {
                    // Separador de fecha
                    const msgDate = new Date(msg.created_at);
                    const dateStr = this._formatDate(msgDate);

                    if (dateStr !== lastDate) {
                        const divider = document.createElement('div');
                        divider.className = 'date-divider';
                        divider.innerHTML = `<span>${dateStr}</span>`;
                        DOM.chatBox.appendChild(divider);
                        lastDate = dateStr;
                    }

                    const type = msg.role === 'user' ? 'user' : 'bot';
                    const content = type === 'user' ? this._escapeHtml(msg.message) : msg.message;

                    const wrapper = document.createElement('div');
                    wrapper.className = `message ${type} history-msg`;

                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'message-content';
                    contentDiv.innerHTML = type === 'bot' ? this._formatMarkdown(content) : content;

                    // Neutralizar botones interactivos del historial
                    // Solicitudes: desactivar botones confirmar/cancelar
                    contentDiv.querySelectorAll('.cb-solicitud--preview').forEach(card => {
                        card.classList.remove('cb-solicitud--preview');
                        card.classList.add('cb-solicitud--expired');
                        const header = card.querySelector('.cb-solicitud-header');
                        if (header) header.innerHTML = '<i class="bi bi-clock-history"></i> Solicitud expirada';
                        const actions = card.querySelector('.cb-solicitud-actions');
                        if (actions) actions.innerHTML = '<div class="cb-solicitud-footer">Vuelve a solicitarlo si aún lo necesitas.</div>';
                    });
                    // Selector de pólizas: desactivar botones
                    contentDiv.querySelectorAll('.cb-poliza-select-btn').forEach(btn => {
                        btn.disabled = true;
                    });
                    // Formularios de siniestro: desactivar
                    contentDiv.querySelectorAll('.cb-siniestro-form').forEach(form => {
                        if (!form.classList.contains('cb-siniestro-form--success') && !form.classList.contains('cb-siniestro-form--cancelled')) {
                            form.classList.add('cb-siniestro-form--cancelled');
                            const header = form.querySelector('.cb-siniestro-form-header');
                            if (header) header.innerHTML = '<i class="bi bi-clock-history"></i> Formulario expirado';
                            const body = form.querySelector('.cb-siniestro-form-body');
                            if (body) body.remove();
                            const actions = form.querySelector('.cb-siniestro-form-actions');
                            if (actions) actions.innerHTML = '<div class="cb-siniestro-form-footer">Vuelve a solicitarlo si aún lo necesitas.</div>';
                        }
                    });
                    // Borrar chat: eliminar confirmación
                    contentDiv.querySelectorAll('.cb-clear-confirm').forEach(el => el.remove());

                    // Hora del mensaje desde el servidor
                    const time = document.createElement('span');
                    time.className = 'message-time';
                    time.textContent = new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                    contentDiv.appendChild(time);

                    wrapper.appendChild(contentDiv);
                    DOM.chatBox.appendChild(wrapper);
                });

                // Separador "Hoy" después del historial
                const divider = document.createElement('div');
                divider.className = 'date-divider';
                divider.innerHTML = '<span>Hoy</span>';
                DOM.chatBox.appendChild(divider);

                // Mensaje de continuación dinámico (hora + nombre)
                this.addMessage('bot', this._dynamicGreeting(true));

                // Scroll al final
                Scroll.toBottom(false);

                // Ocultar quick actions si ya hay historial
                this._quickActionsVisible = false;
                DOM.quickActions.style.display = 'none';

            } catch (err) {
                console.error('[History Error]', err);
                // Si falla, dejar el chat con el mensaje de bienvenida por defecto
            }
        },

        _dynamicGreeting(isReturning) {
            const h = new Date().getHours();
            const saludo = h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
            const nombre = Session.nombre ? Session.nombre.split(' ')[0] : '';
            const nombreHtml = nombre ? `, <strong>${nombre}</strong>` : '';

            if (isReturning) {
                const frases = [
                    `${saludo}${nombreHtml}. ¿Necesitas algo más sobre tus seguros?`,
                    `${saludo}${nombreHtml}. ¿En qué puedo ayudarte?`,
                    `${saludo} de nuevo${nombreHtml}. ¿Qué puedo hacer por ti?`,
                ];
                return frases[Math.floor(Math.random() * frases.length)];
            }

            const frases = [
                `${saludo}${nombreHtml}. Soy <strong>PACCMAN</strong>, tu asistente virtual de seguros. ¿En qué puedo ayudarte?`,
                `${saludo}${nombreHtml}. Soy <strong>PACCMAN</strong>, estoy aquí para ayudarte con tus seguros.`,
                `${saludo}${nombreHtml}. Soy <strong>PACCMAN</strong>. Pregúntame lo que necesites sobre tus seguros.`,
            ];
            return frases[Math.floor(Math.random() * frases.length)];
        },

        _formatDate(date) {
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const isToday = date.toDateString() === today.toDateString();
            const isYesterday = date.toDateString() === yesterday.toDateString();

            if (isToday) return 'Hoy';
            if (isYesterday) return 'Ayer';

            return date.toLocaleDateString('es-ES', {
                day: 'numeric',
                month: 'long',
                year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
            });
        }
    };

    // ===== THEME MODULE =====
    const Theme = {
        _key: 'chatbot-theme',

        init() {
            const saved = localStorage.getItem(this._key);
            if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                this._apply('dark');
            } else {
                this._apply('light');
            }

            if (DOM.btnTheme) {
                DOM.btnTheme.addEventListener('click', () => {
                    DOM.avatarDropdown?.classList.add('hidden');
                    this.toggle();
                });
            }
        },

        toggle() {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            this._apply(next);
            localStorage.setItem(this._key, next);
        },

        _apply(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            const iconClass = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
            const title = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';

            // Actualizar todos los botones de tema
            document.querySelectorAll('#btn-theme, #btn-theme-login').forEach(btn => {
                const icon = btn.querySelector('i');
                if (icon) icon.className = iconClass;
                btn.title = title;
            });
        }
    };

    // ===== TTS MODULE (Text-to-Speech) =====
    const TTS = {
        _speaking: false,
        _currentBtn: null,

        speak(text, btn) {
            // Si ya está hablando este mensaje, parar
            if (this._speaking && this._currentBtn === btn) {
                this.stop();
                return;
            }

            // Si está hablando otro, parar primero
            if (this._speaking) {
                this.stop();
            }

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-ES';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            // Buscar voz española
            const voices = speechSynthesis.getVoices();
            const esVoice = voices.find(v => v.lang.startsWith('es') && v.localService)
                         || voices.find(v => v.lang.startsWith('es'));
            if (esVoice) utterance.voice = esVoice;

            utterance.onstart = () => {
                this._speaking = true;
                this._currentBtn = btn;
                btn.classList.add('speaking');
                btn.innerHTML = '<i class="bi bi-stop-fill"></i>';
                btn.title = 'Parar';
            };

            utterance.onend = () => this._reset(btn);
            utterance.onerror = () => this._reset(btn);

            speechSynthesis.speak(utterance);
        },

        stop() {
            speechSynthesis.cancel();
            if (this._currentBtn) {
                this._reset(this._currentBtn);
            }
        },

        _reset(btn) {
            this._speaking = false;
            this._currentBtn = null;
            if (btn) {
                btn.classList.remove('speaking');
                btn.innerHTML = '<i class="bi bi-volume-up-fill"></i>';
                btn.title = 'Escuchar';
            }
        }
    };

    // ===== VOICE MODULE (click to start / click to stop) =====
    const Voice = {
        _mediaRecorder: null,
        _stream: null,          // stream persistente (se reutiliza)
        _chunks: [],
        _isRecording: false,
        _isBusy: false,
        _timerInterval: null,
        _startTime: 0,
        _streamReady: false,

        init() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                if (DOM.btnMic) DOM.btnMic.style.display = 'none';
                return;
            }
            this._bindEvents();
        },

        _bindEvents() {
            const btn = DOM.btnMic;
            if (!btn) return;

            // Pre-calentar el micrófono al pasar el ratón por encima
            btn.addEventListener('mouseenter', () => this._warmUp(), { once: true });

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (this._isBusy) return;
                if (this._isRecording) {
                    this._stop();
                } else {
                    this._start();
                }
            });
        },

        /** Adquiere el stream del micrófono una sola vez (silencioso) */
        async _warmUp() {
            if (this._stream) return;
            try {
                this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this._streamReady = true;
            } catch (err) {
                // Si rechaza permisos aquí, se reintentará al pulsar
                console.log('[Voice] Warm-up: permisos pendientes');
            }
        },

        /** Asegura que hay stream listo, lo adquiere si no existe */
        async _ensureStream() {
            if (this._stream) {
                // Verificar que las pistas siguen activas
                const tracks = this._stream.getAudioTracks();
                if (tracks.length > 0 && tracks[0].readyState === 'live') {
                    return;
                }
                // Stream muerto, renovar
                this._stream = null;
            }
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this._streamReady = true;
        },

        async _start() {
            this._isBusy = true;
            try {
                await this._ensureStream();

                this._chunks = [];
                this._mediaRecorder = new MediaRecorder(this._stream, { mimeType: this._getSupportedMime() });

                this._mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) this._chunks.push(e.data);
                };

                this._mediaRecorder.onstop = () => {
                    // NO cerramos el stream — lo reutilizamos
                    if (this._chunks.length === 0) {
                        this._updateUI(false);
                        return;
                    }
                    const blob = new Blob(this._chunks, { type: this._mediaRecorder.mimeType });
                    this._sendAudio(blob);
                };

                this._mediaRecorder.start(1000); // Generar datos cada segundo
                this._isRecording = true;
                this._startTime = Date.now();
                this._updateUI(true);
                this._startTimer();

            } catch (err) {
                console.error('[Voice] Mic error:', err);
                UI.toast('No se pudo acceder al micrófono. Revisa los permisos.', 'error');
            } finally {
                this._isBusy = false;
            }
        },

        _stop() {
            if (!this._isRecording || !this._mediaRecorder) return;

            // Validar duración mínima (1.5 segundos)
            const duration = Date.now() - this._startTime;
            if (duration < 1500) {
                this._isRecording = false;
                this._mediaRecorder.stop();
                this._chunks = []; // Descartar audio demasiado corto
                this._stopTimer();
                this._updateUI(false);
                UI.toast('Grabación muy corta. Mantén pulsado al menos 2 segundos.', 'warning');
                return;
            }

            this._isRecording = false;
            this._mediaRecorder.stop();
            this._stopTimer();
            this._updateUI(false);
        },

        /** Libera el stream (llamar al hacer logout) */
        release() {
            if (this._stream) {
                this._stream.getTracks().forEach(t => t.stop());
                this._stream = null;
                this._streamReady = false;
            }
        },

        async _sendAudio(blob) {
            // Verificar que el blob tiene contenido
            if (!blob || blob.size < 1000) {
                Chat.addMessage('bot', '<i class="bi bi-mic-mute"></i> No se captó audio. Comprueba que el micrófono está activo y habla más cerca.');
                return;
            }

            console.log(`[Voice] Audio blob: ${(blob.size / 1024).toFixed(1)}KB, tipo: ${blob.type}`);
            const audioUrl = URL.createObjectURL(blob);
            Chat.addMessage('user', `<div class="message-audio"><i class="bi bi-mic-fill"></i><audio controls src="${audioUrl}"></audio></div>`);
            Chat.showThinking();

            try {
                const formData = new FormData();
                const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('mp4') ? 'mp4' : 'ogg';
                formData.append('audio', blob, `audio.${ext}`);

                const res = await fetch(`${CONFIG.apiUrl}/transcribe`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${Session.token}`,
                        'Empresa': CONFIG.headers.Empresa,
                        'Device': CONFIG.headers.Device
                    },
                    body: formData
                });

                Chat.removeThinking();

                if (res.status === 401) {
                    Session.clear();
                    UI.toast('Tu sesión ha expirado.', 'warning');
                    setTimeout(() => UI.showScreen('login'), 1500);
                    return;
                }

                const data = await res.json();

                if (res.ok && data.message) {
                    // Mostrar qué entendió (transcripción) como contexto
                    if (data.transcription) {
                        Chat.addMessage('user', `<em style="font-size:12px;color:rgba(255,255,255,0.75);">${Chat._escapeHtml(data.transcription)}</em>`);
                    }
                    Chat.addMessage('bot', data.message);
                } else {
                    const errorMsg = data.error || 'No pude procesar el audio.';
                    Chat.addMessage('bot', `<i class="bi bi-exclamation-circle"></i> ${errorMsg} Puedes escribir tu consulta o intentarlo de nuevo.`);
                    console.error('[Voice] Server error:', errorMsg);

                    // Crear solicitud automática si el error es del servidor (no del usuario)
                    if (res.status >= 500) {
                        try {
                            await fetch(`${CONFIG.apiUrl}/confirmar-solicitud`, {
                                method: 'POST',
                                headers: Session.getAuthHeaders(),
                                body: JSON.stringify({
                                    tipo: 'otro',
                                    descripcion: `Solicitud automática: error al procesar audio del cliente. Error: ${errorMsg}`
                                })
                            });
                            Chat.addMessage('bot', 'He registrado una solicitud para que tu ejecutiva de cuentas te contacte.');
                        } catch (solErr) {
                            console.error('[Voice] Error creando solicitud:', solErr);
                        }
                    }
                }
            } catch (err) {
                Chat.removeThinking();
                Chat.addMessage('bot', '<i class="bi bi-wifi-off"></i> No se pudo conectar con el servidor. Puedes escribir tu consulta directamente.');
                UI.toast('Error de conexión al enviar audio', 'error');
                console.error('[Voice Error]', err);
            }
        },

        _getSupportedMime() {
            const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
            for (const mime of mimes) {
                if (MediaRecorder.isTypeSupported(mime)) return mime;
            }
            return 'audio/webm';
        },

        _updateUI(recording) {
            DOM.btnMic.classList.toggle('recording', recording);
            DOM.recordingIndicator.classList.toggle('hidden', !recording);
            // Cambiar tooltip
            DOM.btnMic.title = recording ? 'Pulsa para parar' : 'Pulsa para grabar';
        },

        _startTimer() {
            this._updateTimerDisplay(0);
            this._timerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - this._startTime) / 1000);
                this._updateTimerDisplay(elapsed);
            }, 1000);
        },

        _stopTimer() {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        },

        _updateTimerDisplay(seconds) {
            const m = Math.floor(seconds / 60);
            const s = seconds % 60;
            DOM.recordingTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
        }
    };

    // ===== AUTH MODULE =====
    const Auth = {
        _pendingNif: null,
        _pendingMovil: null,

        /** Guarda NIF/móvil en localStorage para validateSession en próximos reloads */
        _saveCredentials(nif, movil) {
            try {
                localStorage.setItem('userNif', nif);
                localStorage.setItem('userMovil', movil);
            } catch { /* private browsing */ }
        },

        async login(nif, movil) {
            UI.clearLoginError();
            UI.setLoginLoading(true);

            try {
                const res = await fetch(`${CONFIG.apiUrl}/get-token`, {
                    method: 'POST',
                    headers: CONFIG.headers,
                    body: JSON.stringify({ nif, movil })
                });

                const data = await res.json();

                if (res.ok && data.token) {
                    // Sesión reciente → acceso directo sin OTP
                    Session.save(data.token, data.nombre);
                    this._saveCredentials(nif, movil);
                    UI.showScreen('chat');
                    UI.showUserBadge(Session.nombre);
                    Chat.loadHistory();
                } else if (res.ok && data.otp_required) {
                    // OTP requerido → mostrar pantalla de código
                    this._pendingNif = nif;
                    this._pendingMovil = movil;
                    DOM.loginForm.classList.add('hidden');
                    DOM.otpForm.classList.remove('hidden');
                    DOM.otpSubtitle.textContent = `Codigo enviado a ${data.email_masked}`;
                    DOM.otpCode.value = '';
                    DOM.otpCode.focus();
                } else {
                    UI.showLoginError(data.error || 'Credenciales incorrectas');
                }
            } catch (err) {
                UI.showLoginError('No se pudo conectar con el servidor');
                console.error('[Auth Error]', err);
            } finally {
                UI.setLoginLoading(false);
            }
        },

        async verifyOtp(code) {
            DOM.otpErrors.classList.add('hidden');
            DOM.otpSubmitBtn.disabled = true;
            DOM.otpButtonText.textContent = 'Verificando...';
            DOM.otpSpinner.classList.remove('hidden');

            try {
                const res = await fetch(`${CONFIG.apiUrl}/verify-otp`, {
                    method: 'POST',
                    headers: CONFIG.headers,
                    body: JSON.stringify({
                        nif: this._pendingNif,
                        movil: this._pendingMovil,
                        code
                    })
                });

                let data;
                try {
                    data = await res.json();
                } catch {
                    data = {};
                }

                if (res.ok && data.token) {
                    Session.save(data.token, data.nombre);
                    this._saveCredentials(this._pendingNif, this._pendingMovil);
                    UI.showScreen('chat');
                    UI.showUserBadge(Session.nombre);
                    Chat.loadHistory();
                    // Limpiar estado OTP
                    this._pendingNif = null;
                    this._pendingMovil = null;
                } else {
                    const errorMsg = data.error || 'Código incorrecto. Inténtalo de nuevo.';
                    DOM.otpErrors.textContent = errorMsg;
                    DOM.otpErrors.classList.remove('hidden');
                    DOM.otpCode.value = '';
                    DOM.otpCode.focus();
                    console.warn('[OTP] Backend error:', res.status, errorMsg);
                }
            } catch (err) {
                DOM.otpErrors.textContent = 'No se pudo conectar con el servidor. Comprueba tu conexión.';
                DOM.otpErrors.classList.remove('hidden');
                console.error('[OTP Error]', err);
            } finally {
                DOM.otpSubmitBtn.disabled = false;
                DOM.otpButtonText.textContent = 'Verificar';
                DOM.otpSpinner.classList.add('hidden');
            }
        },

        logout() {
            Voice.release();
            Cache.clear();
            Session.clear();
            // Resetear formularios de login: mostrar NIF/móvil, ocultar OTP
            DOM.otpForm.classList.add('hidden');
            DOM.loginForm.classList.remove('hidden');
            DOM.otpCode.value = '';
            DOM.otpErrors.classList.add('hidden');
            DOM.nifInput.value = '';
            DOM.movilInput.value = '';
            DOM.apiErrors.classList.add('hidden');
            UI.showScreen('login');
            // Reset chat con saludo genérico (sin nombre, aún no logueado)
            DOM.chatBox.innerHTML = `
                <div class="date-divider"><span>Hoy</span></div>
                <div class="message bot animate-in">
                    <div class="message-content">${Chat._dynamicGreeting(false)}</div>
                </div>`;
            DOM.quickActions.style.display = 'flex';
            Chat._quickActionsVisible = true;
            UI.showUserBadge(null);
        }
    };

    // ===== SCROLL CONTROL =====
    const Scroll = {
        _userScrolledUp: false,
        _threshold: 150,

        init() {
            DOM.chatBox.addEventListener('scroll', () => {
                const { scrollTop, scrollHeight, clientHeight } = DOM.chatBox;
                this._userScrolledUp = (scrollHeight - scrollTop - clientHeight) > this._threshold;
                DOM.btnScrollDown.classList.toggle('hidden', !this._userScrolledUp);
            });

            DOM.btnScrollDown.addEventListener('click', () => {
                this.toBottom();
            });
        },

        toBottom(smooth = true) {
            DOM.chatBox.scrollTo({
                top: DOM.chatBox.scrollHeight,
                behavior: smooth ? 'smooth' : 'instant'
            });
        },

        /** Auto-scroll solo si el usuario no ha scrolleado arriba */
        auto() {
            if (!this._userScrolledUp) this.toBottom();
        }
    };

    // ===== EVENT BINDING =====
    function bindEvents() {
        // Login form
        DOM.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const nif   = DOM.nifInput.value.trim().toUpperCase();
            const movil = DOM.movilInput.value.trim();
            // Validar móvil (antes estaba en pattern del HTML, pero type=password no lo soporta visualmente)
            if (!/^[67]\d{8}$/.test(movil)) {
                UI.showLoginError('Introduce un número de móvil válido');
                return;
            }
            Auth.login(nif, movil);
        });

        // OTP form
        DOM.otpForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const code = DOM.otpCode.value.trim();
            if (code.length === 6) Auth.verifyOtp(code);
        });

        // OTP volver
        DOM.otpBack.addEventListener('click', () => {
            DOM.otpForm.classList.add('hidden');
            DOM.loginForm.classList.remove('hidden');
            DOM.otpErrors.classList.add('hidden');
            DOM.otpCode.value = '';
        });

        // Chat form
        DOM.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            Chat.send(DOM.chatInput.value);
        });

        // Quick actions
        DOM.quickActions.addEventListener('click', (e) => {
            const btn = e.target.closest('.quick-btn');
            if (btn) {
                const msg = btn.dataset.msg;
                if (msg) Chat.send(msg);
            }
        });

        // Logout
        DOM.logoutBtn.addEventListener('click', () => Auth.logout());

        // Modal funcionalidades
        if (DOM.btnFeatures && DOM.featuresModal) {
            DOM.btnFeatures.addEventListener('click', () => {
                DOM.avatarDropdown?.classList.add('hidden');
                DOM.featuresModal.classList.remove('hidden');
            });

            DOM.featuresClose.addEventListener('click', () => {
                DOM.featuresModal.classList.add('hidden');
            });

            // Cerrar con clic en backdrop
            DOM.featuresModal.querySelector('.features-modal-backdrop').addEventListener('click', () => {
                DOM.featuresModal.classList.add('hidden');
            });

            // Cerrar con Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !DOM.featuresModal.classList.contains('hidden')) {
                    DOM.featuresModal.classList.add('hidden');
                }
            });
        }

        // Avatar dropdown menu
        if (DOM.btnAvatarMenu && DOM.avatarDropdown) {
            DOM.btnAvatarMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                DOM.avatarDropdown.classList.toggle('hidden');
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.avatar-menu-wrap')) {
                    DOM.avatarDropdown.classList.add('hidden');
                }
            });
        }

        // Botón eCliente → acceso con token a sección pólizas
        if (DOM.btnEcliente) {
            DOM.btnEcliente.addEventListener('click', () => {
                DOM.avatarDropdown?.classList.add('hidden');
                window.open(`${CONFIG.eclienteUrl}/access/duplicado/${Session.token}`, '_blank');
            });
        }

        // Botón limpiar conversación (confirmación en el chat)
        if (DOM.btnClearChat) {
            DOM.btnClearChat.addEventListener('click', () => {
                DOM.avatarDropdown?.classList.add('hidden');
                Chat.addMessage('bot',
                    '<div class="cb-clear-confirm">'
                    + '<span>¿Borrar la conversacion actual?</span>'
                    + '<div class="cb-clear-confirm-btns">'
                    + '<button class="cb-clear-btn cb-clear-btn--yes" data-clear="yes">Si, borrar</button>'
                    + '<button class="cb-clear-btn cb-clear-btn--no" data-clear="no">No</button>'
                    + '</div></div>'
                );
                Scroll.auto();
            });
        }

        // Delegated: respuesta a confirmación de borrar chat
        DOM.chatBox.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-clear]');
            if (!btn) return;
            if (btn.dataset.clear === 'yes') {
                DOM.chatBox.innerHTML = '';
                Chat.addMessage('bot', Chat._dynamicGreeting(false));
            } else {
                const confirmDiv = btn.closest('.message');
                if (confirmDiv) confirmDiv.remove();
            }
        });

        // ===== PWA: Instalar en móvil =====
        let _deferredInstallPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            _deferredInstallPrompt = e;
            if (DOM.btnInstallPwa) DOM.btnInstallPwa.style.display = '';
        });

        window.addEventListener('appinstalled', () => {
            _deferredInstallPrompt = null;
            if (DOM.btnInstallPwa) DOM.btnInstallPwa.style.display = 'none';
            UI.toast('App instalada correctamente', 'success');
        });

        if (DOM.btnInstallPwa) {
            DOM.btnInstallPwa.addEventListener('click', async () => {
                DOM.avatarDropdown?.classList.add('hidden');
                if (_deferredInstallPrompt) {
                    _deferredInstallPrompt.prompt();
                    const { outcome } = await _deferredInstallPrompt.userChoice;
                    if (outcome === 'accepted') {
                        _deferredInstallPrompt = null;
                        DOM.btnInstallPwa.style.display = 'none';
                    }
                } else {
                    // Fallback: instrucciones manuales (iOS, navegadores sin soporte)
                    Chat.addMessage('bot',
                        '<b>Para instalar la app en tu dispositivo:</b><br><br>'
                        + '<b>Android (Chrome):</b> Pulsa el menú ⋮ y selecciona "Añadir a pantalla de inicio".<br><br>'
                        + '<b>iPhone/iPad (Safari):</b> Pulsa el botón compartir <i class="bi bi-box-arrow-up"></i> y selecciona "Añadir a pantalla de inicio".'
                    );
                }
            });

            // Mostrar el botón si la app ya es instalable (standalone no activo)
            if (!window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone) {
                // En iOS/Safari no hay beforeinstallprompt, mostrar siempre para dar instrucciones
                const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
                if (isIos) DOM.btnInstallPwa.style.display = '';
            }
        }

        // Delegated click: data-solicitud links (from API HTML responses)
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-solicitud]');
            if (!el) return;
            e.preventDefault();

            const solicitud = el.getAttribute('data-solicitud');
            if (!solicitud) return;

            const parts = solicitud.split('#');
            if (parts.length === 3 && parts[0] === 'ecliente') {
                const [, entidad, id] = parts;
                // Siniestro: abrir formulario inline en vez de URL externa
                if (entidad === 'siniestro') {
                    Chat.send('Quiero abrir un siniestro');
                    return;
                }
                window.open(`${CONFIG.eclienteUrl}/access/${entidad}/${Session.token}/${id}`);
                return;
            }
            Chat.send(solicitud);
        });

        // Botones de acción inline (siniestros, etc.)
        DOM.chatBox.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.cb-action-btn');
            if (!actionBtn) return;

            // Interceptar enlaces de siniestro (href externo) → formulario inline
            const href = actionBtn.getAttribute('href') || '';
            const text = actionBtn.textContent.toLowerCase();
            if (href.includes('/siniestro') || text.includes('siniestro')) {
                e.preventDefault();
                Chat.send('Quiero abrir un siniestro');
                return;
            }

            const msg = actionBtn.dataset.msg;
            if (msg) {
                // Deshabilitar todos los botones del grupo
                const group = actionBtn.closest('.cb-action-buttons');
                if (group) group.querySelectorAll('.cb-action-btn').forEach(b => b.disabled = true);
                Chat.send(msg);
            }
        });

        // Selección de póliza para anulación/modificación/duplicado
        DOM.chatBox.addEventListener('click', async (e) => {
            const selectBtn = e.target.closest('.cb-poliza-select-btn');
            if (!selectBtn) return;

            const accion = selectBtn.dataset.accion;
            const poliza = selectBtn.dataset.poliza;
            const desc = selectBtn.dataset.desc;

            // Marcar como seleccionada
            const selector = selectBtn.closest('.cb-poliza-selector');
            selector.querySelectorAll('.cb-poliza-option').forEach(opt => opt.classList.remove('cb-poliza-option--selected'));
            selectBtn.closest('.cb-poliza-option').classList.add('cb-poliza-option--selected');
            selector.querySelectorAll('.cb-poliza-select-btn').forEach(b => {
                b.disabled = true;
                b.textContent = accion === 'duplicado' ? 'Descargar' : accion === 'wallet' ? 'Wallet' : 'Seleccionar';
            });
            selectBtn.disabled = false;

            // Flujo wallet: solicitar tarjeta wallet de la póliza
            if (accion === 'wallet') {
                const contrato = selectBtn.dataset.contrato;

                selectBtn.textContent = 'Solicitando...';
                selectBtn.classList.add('cb-poliza-select-btn--loading');

                try {
                    const res = await fetch(`${CONFIG.apiWallet}?contrato=${encodeURIComponent(contrato)}`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'Empresa': CONFIG.headers.Empresa
                        }
                    });

                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err.error || 'Error al solicitar wallet');
                    }

                    selectBtn.textContent = 'Solicitado';
                    selectBtn.classList.remove('cb-poliza-select-btn--loading');
                    selectBtn.classList.add('cb-poliza-select-btn--success');

                    Chat.addMessage('bot',
                        `<i class="bi bi-wallet2"></i> He solicitado la tarjeta wallet de tu póliza ${poliza} (${desc}). Recibirás un enlace para añadirla a tu dispositivo.`
                    );

                } catch (err) {
                    selectBtn.textContent = 'Error';
                    selectBtn.classList.remove('cb-poliza-select-btn--loading');
                    selectBtn.classList.add('cb-poliza-select-btn--error');
                    console.error('Error solicitando wallet:', err);
                    Chat.addMessage('bot', `No he podido solicitar la tarjeta wallet de la póliza ${poliza} (${desc}). Contacta con tu oficina.`);
                }
                return;
            }

            // Flujo duplicado: descargar PDF directamente
            if (accion === 'duplicado') {
                const contrato = selectBtn.dataset.contrato;

                selectBtn.textContent = 'Descargando...';
                selectBtn.classList.add('cb-poliza-select-btn--loading');

                try {
                    const res = await fetch(`${CONFIG.apiDuplicado}?contrato=${encodeURIComponent(contrato)}`, {
                        headers: Session.getAuthHeaders()
                    });

                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err.error || 'Error al descargar');
                    }

                    // Obtener nombre del fichero del header o generar uno
                    const disposition = res.headers.get('Content-Disposition');
                    let filename = `duplicado_${poliza || contrato}.pdf`;
                    if (disposition) {
                        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                        if (match && match[1]) filename = match[1].replace(/['"]/g, '');
                    }

                    const blob = await res.blob();
                    const blobUrl = URL.createObjectURL(blob);

                    // Descargar automáticamente
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    selectBtn.textContent = 'Descargado';
                    selectBtn.classList.remove('cb-poliza-select-btn--loading');
                    selectBtn.classList.add('cb-poliza-select-btn--success');

                    // Mensaje con botón para abrir el PDF
                    Chat.addMessage('bot',
                        `He descargado el duplicado de tu póliza ${poliza} (${desc}).`
                        + `<a href="${blobUrl}" target="_blank" class="cb-pdf-open-btn">`
                        + `<i class="bi bi-file-earmark-pdf"></i> Abrir PDF</a>`
                    );

                } catch (err) {
                    selectBtn.textContent = 'Error';
                    selectBtn.classList.remove('cb-poliza-select-btn--loading');
                    selectBtn.classList.add('cb-poliza-select-btn--error');
                    console.error('Error descargando duplicado:', err);

                    try {
                        const descSolicitud = `Solicitud automática: no se pudo descargar el duplicado de la póliza ${poliza} (${desc}). El cliente necesita que se le envíe el documento.`;
                        const resSol = await fetch(`${CONFIG.apiUrl}/confirmar-solicitud`, {
                            method: 'POST',
                            headers: Session.getAuthHeaders(),
                            body: JSON.stringify({ tipo: 'poliza', descripcion: descSolicitud })
                        });
                        if (resSol.ok) {
                            Chat.addMessage('bot', `No he podido descargar el duplicado de la póliza ${poliza} (${desc}), pero he registrado una solicitud para que tu ejecutiva de cuentas te lo envíe.`);
                        } else {
                            Chat.addMessage('bot', `No he podido descargar el duplicado de la póliza ${poliza}. Contacta con tu oficina para obtenerlo.`);
                        }
                    } catch (solErr) {
                        console.error('Error creando solicitud de duplicado:', solErr);
                        Chat.addMessage('bot', `No he podido descargar el duplicado de la póliza ${poliza}. Contacta con tu oficina para obtenerlo.`);
                    }
                }
                return;
            }

            // Flujo siniestro: abrir formulario inline bajo el selector
            if (accion === 'siniestro') {
                selectBtn.textContent = 'Seleccionada';
                const ramoTipo = selectBtn.dataset.ramoTipo || '';
                const contrato = selectBtn.dataset.contrato || poliza;
                // Extraer datos de la opción seleccionada para mostrar en el formulario
                const optionEl = selectBtn.closest('.cb-poliza-option');
                const polizaInfo = {
                    ramo: optionEl?.querySelector('.cb-poliza-option-ramo')?.textContent?.trim() || '',
                    cia: optionEl?.querySelector('.cb-poliza-option-cia')?.textContent?.trim() || '',
                    meta: optionEl?.querySelector('.cb-poliza-option-meta')?.textContent?.trim() || ''
                };
                // Ocultar el listado de pólizas tras seleccionar
                selector.style.display = 'none';
                SiniestroForm.loadForm(selector, contrato, poliza, desc, ramoTipo, polizaInfo);
                return;
            }

            // Flujo anulación/modificación: enviar mensaje al bot
            selectBtn.textContent = 'Seleccionada';
            const msg = `Quiero ${accion} la póliza ${poliza} (${desc})`;
            Chat.send(msg);
        });

        // ===== FORMULARIO SINIESTRO (inline bajo selector de póliza) =====
        const SiniestroForm = {
            _allCausas: null, // cache de causas

            /** Inicializa un picker inline (buscador + lista + chip) */
            _initPicker(container, items, opts) {
                const hidden = container.querySelector('input[type="hidden"]');
                const search = container.querySelector('.cb-picker-search');
                const list = container.querySelector('.cb-picker-list');
                const selectedEl = container.querySelector('.cb-picker-selected');
                let activeIdx = -1, picked = null, onPickCb = null;

                const { placeholder, searchFields, renderItem, renderChip } = opts;
                search.setAttribute('placeholder', placeholder);

                function render(term = '') {
                    const t = term.toLowerCase();
                    const filtered = t ? items.filter(it => searchFields(it).toLowerCase().includes(t)) : items;
                    activeIdx = -1;
                    if (!filtered.length) { list.innerHTML = '<li class="cb-picker-hint">Sin resultados</li>'; return; }
                    list.innerHTML = filtered.map(it => renderItem(it)).join('');
                    list.querySelectorAll('.cb-picker-item').forEach(el => {
                        el.addEventListener('click', () => pick(el.dataset.value));
                    });
                }

                function pick(value) {
                    const found = items.find(x => String(x.codigo ?? x.id ?? '') === String(value));
                    if (!found) return;
                    picked = found;
                    hidden.value = value;
                    selectedEl.innerHTML = `<div class="cb-picker-chip">${renderChip(found)}<button type="button" class="cb-picker-clear" title="Cambiar"><i class="bi bi-x-lg"></i></button></div>`;
                    selectedEl.style.display = '';
                    search.style.display = 'none';
                    list.innerHTML = '';
                    selectedEl.querySelector('.cb-picker-clear').addEventListener('click', clear);
                    if (onPickCb) onPickCb(found);
                }

                function clear() {
                    picked = null;
                    hidden.value = '';
                    selectedEl.style.display = 'none';
                    selectedEl.innerHTML = '';
                    search.style.display = '';
                    search.value = '';
                    list.innerHTML = '';
                    if (onPickCb) onPickCb(null);
                }

                search.addEventListener('input', () => render(search.value.trim()));
                search.addEventListener('focus', () => { if (!picked) render(search.value.trim()); });
                search.addEventListener('keydown', (e) => {
                    const els = list.querySelectorAll('.cb-picker-item');
                    if (!els.length) return;
                    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = activeIdx < els.length - 1 ? activeIdx + 1 : 0; }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = activeIdx > 0 ? activeIdx - 1 : els.length - 1; }
                    else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0) pick(els[activeIdx].dataset.value); return; }
                    else return;
                    els.forEach((el, i) => { el.classList.toggle('active', i === activeIdx); if (i === activeIdx) el.scrollIntoView({ block: 'nearest' }); });
                });

                // Cerrar lista al hacer click fuera
                document.addEventListener('click', (e) => { if (!container.contains(e.target)) list.innerHTML = ''; });

                return {
                    get value() { return picked; },
                    get rawValue() { return hidden.value; },
                    onPick(cb) { onPickCb = cb; },
                    setItems(newItems) { items = newItems; clear(); },
                    clear,
                };
            },

            /** Carga causas (con cache) y muestra el formulario bajo el selector */
            async loadForm(selectorEl, contrato, ciaPoliza, polizaDesc, ramoTipo, polizaInfo) {
                const msgContent = selectorEl.closest('.message-content');

                // Mostrar spinner bajo el selector
                const loader = document.createElement('div');
                loader.className = 'cb-siniestro-form-loading';
                loader.innerHTML = '<i class="bi bi-hourglass-split"></i> Cargando formulario...';
                msgContent.appendChild(loader);

                try {
                    // Cargar causas (solo la primera vez, luego cache)
                    if (!this._allCausas) {
                        const res = await fetch(`${CONFIG.apiUrl}/presiniestro-data`, { headers: Session.getAuthHeaders() });
                        if (!res.ok) throw new Error('Error al cargar datos');
                        const data = await res.json();
                        this._allCausas = data.causas || [];
                    }

                    // Filtrar causas por ramo_tipo de la póliza seleccionada
                    const causasFiltradas = ramoTipo
                        ? this._allCausas.filter(c => c.tipo && c.tipo.includes(ramoTipo))
                        : this._allCausas;

                    loader.remove();

                    const today = new Date().toISOString().split('T')[0];

                    // Bloque informativo con datos de la póliza (orden: póliza, cia, ramo, riesgo)
                    // meta puede contener "Póliza: XXX · Dirección · Desde: fecha"
                    const metaParts = (polizaInfo?.meta || '').split('·').map(s => s.trim()).filter(Boolean);
                    const riesgo = metaParts.find(p => !p.startsWith('Póliza:') && !p.startsWith('Desde:')) || '';
                    const infoItems = [ciaPoliza, polizaInfo?.cia, polizaInfo?.ramo, riesgo].filter(Boolean);
                    const polizaInfoHtml = infoItems.length
                        ? `<div class="cb-siniestro-form-poliza-info">${infoItems.join(' · ')}</div>`
                        : '';

                    const formHtml = `
                        <div class="cb-siniestro-form" data-contrato="${contrato}" data-cia-poliza="${ciaPoliza}" data-poliza-desc="${polizaDesc}">
                            <div class="cb-siniestro-form-header"><i class="bi bi-shield-exclamation"></i> Registro de siniestro</div>
                            <div class="cb-siniestro-form-body">
                                ${polizaInfoHtml}
                                <div class="cb-siniestro-form-group">
                                    <label class="cb-siniestro-form-label">Causa del siniestro</label>
                                    <div class="cb-picker-container cb-picker-causa">
                                        <input type="hidden" name="causa">
                                        <input type="text" class="cb-picker-search cb-siniestro-form-input" autocomplete="off">
                                        <ul class="cb-picker-list"></ul>
                                        <div class="cb-picker-selected" style="display:none"></div>
                                    </div>
                                </div>
                                <div class="cb-siniestro-form-group">
                                    <label class="cb-siniestro-form-label">Fecha del siniestro</label>
                                    <input type="date" class="cb-siniestro-form-date cb-siniestro-form-input" max="${today}">
                                </div>
                                <div class="cb-siniestro-form-group">
                                    <label class="cb-siniestro-form-label">Descripción de lo ocurrido</label>
                                    <textarea class="cb-siniestro-form-textarea cb-siniestro-form-input" placeholder="Describe brevemente qué ha ocurrido..." rows="3"></textarea>
                                </div>
                                <div class="cb-siniestro-form-group">
                                    <label class="cb-siniestro-form-label">Imágenes (opcional)</label>
                                    <div class="cb-siniestro-images">
                                        <label class="cb-siniestro-images-add" title="Añadir imágenes">
                                            <i class="bi bi-camera"></i>
                                            <span>Añadir fotos</span>
                                            <input type="file" class="cb-siniestro-images-input" accept="image/*" multiple hidden>
                                        </label>
                                        <div class="cb-siniestro-images-preview"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="cb-siniestro-form-actions">
                                <button class="cb-siniestro-form-btn cb-siniestro-form-btn--cancel"><i class="bi bi-x-lg"></i> Cancelar</button>
                                <button class="cb-siniestro-form-btn cb-siniestro-form-btn--submit" disabled><i class="bi bi-check-lg"></i> Registrar siniestro</button>
                            </div>
                        </div>`;

                    msgContent.insertAdjacentHTML('beforeend', formHtml);
                    const form = msgContent.querySelector('.cb-siniestro-form');

                    // Inicializar picker de causas con las causas ya filtradas
                    const causaPicker = this._initPicker(
                        form.querySelector('.cb-picker-causa'),
                        causasFiltradas,
                        {
                            placeholder: 'Busca una causa...',
                            searchFields: c => c.nombre,
                            renderItem: c => `<li class="cb-picker-item" data-value="${c.codigo}">${c.nombre}</li>`,
                            renderChip: c => c.nombre,
                        }
                    );

                    // Validación en tiempo real
                    const updateValidation = () => this._updateSubmit(form);
                    causaPicker.onPick(updateValidation);
                    form.addEventListener('input', updateValidation);
                    form.addEventListener('change', updateValidation);
                    // Escuchar directamente en fecha y textarea por si no burbujean
                    form.querySelector('.cb-siniestro-form-date')?.addEventListener('input', updateValidation);
                    form.querySelector('.cb-siniestro-form-date')?.addEventListener('change', updateValidation);
                    form.querySelector('.cb-siniestro-form-textarea')?.addEventListener('input', updateValidation);

                    // Selector de imágenes
                    const imgInput = form.querySelector('.cb-siniestro-images-input');
                    const imgPreview = form.querySelector('.cb-siniestro-images-preview');
                    const imgFiles = []; // almacena los File seleccionados
                    form._siniestroImages = imgFiles; // referencia para el envío

                    imgInput.addEventListener('change', () => {
                        for (const file of imgInput.files) {
                            if (!file.type.startsWith('image/')) continue;
                            if (imgFiles.length >= 5) break; // máximo 5 imágenes
                            imgFiles.push(file);
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                const idx = imgFiles.indexOf(file);
                                const thumb = document.createElement('div');
                                thumb.className = 'cb-siniestro-images-thumb';
                                thumb.innerHTML = `<img src="${ev.target.result}" alt=""><button type="button" class="cb-siniestro-images-remove" data-idx="${idx}" title="Quitar"><i class="bi bi-x-lg"></i></button>`;
                                imgPreview.appendChild(thumb);
                            };
                            reader.readAsDataURL(file);
                        }
                        imgInput.value = '';
                        // Ocultar botón añadir si ya hay 5
                        form.querySelector('.cb-siniestro-images-add').style.display = imgFiles.length >= 5 ? 'none' : '';
                    });

                    imgPreview.addEventListener('click', (ev) => {
                        const removeBtn = ev.target.closest('.cb-siniestro-images-remove');
                        if (!removeBtn) return;
                        const idx = parseInt(removeBtn.dataset.idx, 10);
                        imgFiles.splice(idx, 1);
                        // Reconstruir previews
                        imgPreview.innerHTML = '';
                        imgFiles.forEach((f, i) => {
                            const reader = new FileReader();
                            reader.onload = (e2) => {
                                const thumb = document.createElement('div');
                                thumb.className = 'cb-siniestro-images-thumb';
                                thumb.innerHTML = `<img src="${e2.target.result}" alt=""><button type="button" class="cb-siniestro-images-remove" data-idx="${i}" title="Quitar"><i class="bi bi-x-lg"></i></button>`;
                                imgPreview.appendChild(thumb);
                            };
                            reader.readAsDataURL(f);
                        });
                        form.querySelector('.cb-siniestro-images-add').style.display = imgFiles.length >= 5 ? 'none' : '';
                    });

                    // Bloquear Enter excepto en picker
                    form.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.target.classList.contains('cb-picker-search')) e.preventDefault();
                    });

                    Scroll.auto();

                } catch (err) {
                    console.error('Error cargando formulario siniestro:', err);
                    loader.innerHTML = '<i class="bi bi-exclamation-triangle"></i> No se pudo cargar el formulario. Inténtalo de nuevo.';
                }
            },

            /** Actualiza estado del botón submit */
            _updateSubmit(form) {
                const causa = form.querySelector('[name="causa"]')?.value || '';
                const fecha = form.querySelector('.cb-siniestro-form-date')?.value || '';
                const desc = (form.querySelector('.cb-siniestro-form-textarea')?.value || '').trim();
                const btn = form.querySelector('.cb-siniestro-form-btn--submit');
                const valid = causa.length > 0 && fecha.length > 0 && desc.length >= 10;
                if (btn) btn.disabled = !valid;
            },
        };

        // Formulario siniestro: enviar o cancelar
        DOM.chatBox.addEventListener('click', async (e) => {
            // Cancelar
            const cancelBtn = e.target.closest('.cb-siniestro-form-btn--cancel');
            if (cancelBtn) {
                const form = cancelBtn.closest('.cb-siniestro-form');
                form.classList.add('cb-siniestro-form--cancelled');
                form.querySelector('.cb-siniestro-form-header').innerHTML = '<i class="bi bi-x-circle"></i> Registro cancelado';
                const body = form.querySelector('.cb-siniestro-form-body');
                if (body) body.remove();
                const actions = form.querySelector('.cb-siniestro-form-actions');
                if (actions) actions.remove();
                Chat.addMessage('bot', 'De acuerdo, he cancelado el registro de siniestro. Si lo necesitas más adelante, solo dímelo.');
                return;
            }

            // Enviar
            const submitBtn = e.target.closest('.cb-siniestro-form-btn--submit');
            if (!submitBtn || submitBtn.disabled) return;

            const form = submitBtn.closest('.cb-siniestro-form');
            const contrato = form.dataset.contrato;
            const ciaPoliza = form.dataset.ciaPoliza;
            const causaVal = form.querySelector('[name="causa"]').value;
            const causaText = form.querySelector('.cb-picker-chip')?.textContent?.trim() || causaVal;
            const fecha = form.querySelector('.cb-siniestro-form-date').value;
            const descripcion = form.querySelector('.cb-siniestro-form-textarea').value.trim();
            const imgFiles = form._siniestroImages || [];

            if (!contrato || !causaVal || !fecha || descripcion.length < 10) return;

            // Obtener descripción de la póliza
            const headerText = form.dataset.polizaDesc || ciaPoliza;

            // Deshabilitar formulario
            form.querySelectorAll('input, textarea, button').forEach(el => el.disabled = true);
            submitBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Registrando...';

            try {
                const formData = new FormData();
                formData.append('poliza', contrato);
                formData.append('causa', causaVal);
                formData.append('fecha', fecha);
                formData.append('descripcion', descripcion);
                // Añadir imágenes si las hay
                imgFiles.forEach(file => formData.append('imagenes', file));

                const authHeaders = { ...Session.getAuthHeaders() };
                // Eliminar Content-Type para que el navegador lo ponga con boundary de multipart
                delete authHeaders['Content-Type'];
                const res = await fetch(`${CONFIG.apiUrl}/presiniestro`, {
                    method: 'POST',
                    headers: authHeaders,
                    body: formData
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || 'Error al registrar');
                }

                form.classList.add('cb-siniestro-form--success');
                form.querySelector('.cb-siniestro-form-header').innerHTML = '<i class="bi bi-check-circle-fill"></i> Siniestro registrado';

                // Formatear fecha legible
                const fechaObj = new Date(fecha + 'T00:00:00');
                const fechaFmt = fechaObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

                // Resumen con los datos registrados
                const imgCount = imgFiles.length;
                const imgBadge = imgCount > 0
                    ? `<div class="cb-siniestro-summary-row"><span class="cb-siniestro-summary-label"><i class="bi bi-camera"></i> Imágenes</span><span class="cb-siniestro-summary-value">${imgCount} foto${imgCount > 1 ? 's' : ''} adjunta${imgCount > 1 ? 's' : ''}</span></div>`
                    : '';

                const bodyEl = form.querySelector('.cb-siniestro-form-body');
                if (bodyEl) {
                    bodyEl.innerHTML = `
                        <div class="cb-siniestro-summary">
                            <div class="cb-siniestro-summary-row"><span class="cb-siniestro-summary-label"><i class="bi bi-file-earmark-text"></i> Póliza</span><span class="cb-siniestro-summary-value">${headerText}</span></div>
                            <div class="cb-siniestro-summary-row"><span class="cb-siniestro-summary-label"><i class="bi bi-exclamation-triangle"></i> Causa</span><span class="cb-siniestro-summary-value">${causaText}</span></div>
                            <div class="cb-siniestro-summary-row"><span class="cb-siniestro-summary-label"><i class="bi bi-calendar-event"></i> Fecha</span><span class="cb-siniestro-summary-value">${fechaFmt}</span></div>
                            <div class="cb-siniestro-summary-row"><span class="cb-siniestro-summary-label"><i class="bi bi-chat-left-text"></i> Descripción</span><span class="cb-siniestro-summary-value">${descripcion}</span></div>
                            ${imgBadge}
                        </div>`;
                }
                form.querySelector('.cb-siniestro-form-actions').innerHTML = '<div class="cb-siniestro-form-footer"><i class="bi bi-info-circle"></i> Tu ejecutiva de cuentas revisará el parte y se pondrá en contacto contigo.</div>';


            } catch (err) {
                console.error('Error registrando siniestro:', err);
                form.querySelectorAll('input, textarea').forEach(el => el.disabled = false);
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="bi bi-check-lg"></i> Registrar siniestro';
                form.querySelector('.cb-siniestro-form-btn--cancel').disabled = false;
                Chat.addMessage('bot', `No he podido registrar el siniestro. Inténtalo de nuevo o contacta con tu oficina.`);
            }
        });

        // Solicitud de cambio: confirmar / cancelar
        DOM.chatBox.addEventListener('click', async (e) => {
            const confirmBtn = e.target.closest('.cb-solicitud-btn--confirm');
            const cancelBtn = e.target.closest('.cb-solicitud-btn--cancel');

            if (confirmBtn) {
                const card = confirmBtn.closest('.cb-solicitud');
                const tipo = confirmBtn.dataset.tipo;
                const desc = confirmBtn.dataset.desc;
                card.querySelectorAll('.cb-solicitud-btn').forEach(b => b.disabled = true);
                confirmBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...';

                try {
                    const res = await fetch(`${CONFIG.apiUrl}/confirmar-solicitud`, {
                        method: 'POST',
                        headers: Session.getAuthHeaders(),
                        body: JSON.stringify({ tipo, descripcion: desc })
                    });
                    if (res.ok) {
                        card.classList.remove('cb-solicitud--preview');
                        card.classList.add('cb-solicitud--confirmed');
                        card.querySelector('.cb-solicitud-header').innerHTML = '<i class="bi bi-check-circle-fill"></i> Solicitud registrada';
                        card.querySelector('.cb-solicitud-actions').innerHTML = '<div class="cb-solicitud-footer">Tu ejecutiva de cuentas revisará la solicitud y se pondrá en contacto contigo.</div>';
                    } else {
                        confirmBtn.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Error';
                        UI.toast('No se pudo registrar la solicitud', 'error');
                        card.querySelectorAll('.cb-solicitud-btn').forEach(b => b.disabled = false);
                        confirmBtn.innerHTML = '<i class="bi bi-check-lg"></i> Confirmar';
                    }
                } catch (err) {
                    console.error('[Solicitud Error]', err);
                    UI.toast('Error de conexión', 'error');
                    card.querySelectorAll('.cb-solicitud-btn').forEach(b => b.disabled = false);
                    confirmBtn.innerHTML = '<i class="bi bi-check-lg"></i> Confirmar';
                }
            }

            if (cancelBtn) {
                const card = cancelBtn.closest('.cb-solicitud');
                card.classList.add('cb-solicitud--cancelled');
                card.querySelector('.cb-solicitud-header').innerHTML = '<i class="bi bi-x-circle"></i> Solicitud cancelada';
                card.querySelector('.cb-solicitud-actions').remove();
                Chat.addMessage('bot', 'De acuerdo, la solicitud ha sido cancelada. Si necesitas algo más, estoy aquí.');
            }
        });

        // Formulario de solicitud inline
        DOM.chatBox.addEventListener('input', (e) => {
            const input = e.target.closest('.cb-contact-form-input');
            if (!input) return;
            const sendBtn = input.closest('.cb-contact-form-row').querySelector('.cb-contact-form-send');
            if (sendBtn) sendBtn.disabled = input.value.trim().length < 3;
        });

        DOM.chatBox.addEventListener('click', async (e) => {
            const sendBtn = e.target.closest('.cb-contact-form-send');
            if (!sendBtn || sendBtn.disabled) return;
            const row = sendBtn.closest('.cb-contact-form-row');
            const input = row.querySelector('.cb-contact-form-input');
            const form = sendBtn.closest('.cb-contact-form');
            const asunto = input.value.trim();
            if (!asunto) return;
            sendBtn.disabled = true;
            input.disabled = true;
            sendBtn.innerHTML = '<i class="bi bi-hourglass-split"></i>';
            try {
                const res = await fetch(`${CONFIG.apiUrl}/confirmar-solicitud`, {
                    method: 'POST',
                    headers: Session.getAuthHeaders(),
                    body: JSON.stringify({ tipo: 'otro', descripcion: `Solicitud del cliente: ${asunto}` })
                });
                if (res.ok) {
                    form.innerHTML = '<div class="cb-contact-form-sent"><i class="bi bi-check-circle-fill"></i> Solicitud enviada. Tu ejecutiva recibirá un email con tu consulta.</div>';
                    Chat.addMessage('bot', 'He registrado tu solicitud. Tu ejecutiva de cuentas se pondrá en contacto contigo lo antes posible.');
                } else {
                    sendBtn.disabled = false; input.disabled = false;
                    sendBtn.innerHTML = '<i class="bi bi-send-fill"></i>';
                    UI.toast('No se pudo enviar la solicitud. Inténtalo de nuevo.', 'error');
                }
            } catch (err) {
                console.error('[Contact Form Error]', err);
                sendBtn.disabled = false; input.disabled = false;
                sendBtn.innerHTML = '<i class="bi bi-send-fill"></i>';
                UI.toast('Error de conexión', 'error');
            }
        });

        // Enter key en formulario de contacto
        DOM.chatBox.addEventListener('keydown', (e) => {
            const input = e.target.closest('.cb-contact-form-input');
            if (!input || e.key !== 'Enter') return;
            e.preventDefault();
            const sendBtn = input.closest('.cb-contact-form-row').querySelector('.cb-contact-form-send');
            if (sendBtn && !sendBtn.disabled) sendBtn.click();
        });

        // Keyboard: Enter to send (without shift)
        DOM.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const dd = document.getElementById('autocomplete-dropdown');
                if (dd && !dd.classList.contains('hidden') && dd.querySelector('.autocomplete-item.selected')) {
                    return;
                }
                e.preventDefault();
                const text = DOM.chatInput.value.trim();
                if (text) Chat.send(text);
            }
        });
    }

    // ===== INIT =====
    async function init() {
        cacheDom();
        Theme.init();
        bindEvents();
        Voice.init();
        Autocomplete.init();
        Scroll.init();

        if (Session.init()) {
            // Validar con el backend que la sesión sigue válida (control de IP)
            try {
                const nif = localStorage.getItem('userNif');
                const movil = localStorage.getItem('userMovil');
                if (nif && movil) {
                    const res = await fetch(`${CONFIG.apiUrl}/validate-session`, {
                        method: 'POST',
                        headers: CONFIG.headers,
                        body: JSON.stringify({ nif, movil })
                    });
                    const data = await res.json();
                    if (res.ok && data.valid && data.token) {
                        Session.save(data.token, data.nombre);
                        UI.showScreen('chat');
                        UI.showUserBadge(Session.nombre);
                        Chat.loadHistory();
                    } else {
                        // Sesión inválida (expirada o IP diferente) → login
                        Session.clear();
                        UI.showScreen('login');
                    }
                } else {
                    UI.showScreen('chat');
                    UI.showUserBadge(Session.nombre);
                    Chat.loadHistory();
                }
            } catch (err) {
                console.error('[Session validation error]', err);
                // Si falla la validación, permitir usar la sesión cacheada
                UI.showScreen('chat');
                UI.showUserBadge(Session.nombre);
                Chat.loadHistory();
            }
        } else {
            UI.showScreen('login');
        }
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { Session, Chat, Auth, UI, Voice, Theme };
})();