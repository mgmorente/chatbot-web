const apiUrl = `${ENV.API_URL}`;
const eclienteUrl = `${ENV.ECLIENTE_URL}`;
const SESSION_DURATION = 2 * 60 * 60 * 1000; // 2 horas en ms

document.addEventListener('DOMContentLoaded', () => {
    const userModalEl = document.getElementById('userModal');
    const userModal = new bootstrap.Modal(userModalEl, {
        backdrop: 'static',
        keyboard: false
    });

    // --- Gestión Token y sesión ---
    const tokenData = getStoredToken();

    if (!tokenData || !tokenData.token || tokenData.expiry < Date.now()) {
        // Token no existe o expirado
        clearStoredToken();
        userModal.show();
    }

    // --- Funciones auxiliares de token ---
    function getStoredToken() {
        try {
            const token = localStorage.getItem('userToken');
            const expiry = parseInt(localStorage.getItem('userTokenExpiry'), 10);
            if (!token || !expiry) return null;
            return { token, expiry };
        } catch {
            return null;
        }
    }

    function storeToken(token) {
        localStorage.setItem('userToken', token);
        localStorage.setItem('userTokenExpiry', (Date.now() + SESSION_DURATION).toString());
    }

    function clearStoredToken() {
        localStorage.removeItem('userToken');
        localStorage.removeItem('userTokenExpiry');
    }

    // --- Variables para token en sesión ---
    let userToken = tokenData?.token || '';

    // --- Login ---
    document.getElementById('user-data-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        clearApiError();

        const submitButton = document.getElementById('submitButton');
        const spinner = document.getElementById('spinner');
        const buttonText = document.getElementById('buttonText');

        spinner.classList.remove('d-none');
        buttonText.textContent = "Procesando...";
        submitButton.disabled = true;

        const nif = document.getElementById('nif').value.trim().toUpperCase();
        const movil = document.getElementById('movil').value.trim();

        try {
            const response = await fetch(`${apiUrl}/get-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Empresa': 'pacc',
                    'Device': 'web'
                },
                body: JSON.stringify({ nif, movil }),
            });

            const data = await response.json();

            if (response.ok && data.token) {
                userToken = data.token;
                storeToken(userToken);
                userModal.hide();
            } else {
                showApiError(data.error || 'Error al autenticar');
            }
        } catch (err) {
            showApiError('Error de conexión');
            console.error(err);
        } finally {
            spinner.classList.add('d-none');
            buttonText.textContent = "Entrar";
            submitButton.disabled = false;
        }
    });

    // --- Enviar mensaje de chat ---
    document.getElementById('chat-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const messageInput = document.getElementById('chat-message');
        const message = messageInput.value.trim();
        if (!message) return;

        addMessageToChat('user', message);
        addMessageToChatThinking();

        try {
            const response = await fetch(`${apiUrl}/consulta`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userToken}`,
                    'Empresa': 'pacc',
                    'Device': 'web'
                },
                body: JSON.stringify({ consulta: message }),
            });

            const data = await response.json();
            removeThinkingMessage();

            if (response.ok && data.message) {
                addMessageToChat('bot', data.message);
            } else {
                addMessageToChat('bot', data.error || 'Error en la respuesta del servidor');
            }
        } catch (err) {
            removeThinkingMessage();
            addMessageToChat('bot', 'Error de conexión con el servidor');
            console.error(err);
        } finally {
            messageInput.value = '';
        }
    });

    // --- Eventos para botones "order" ---
    document.querySelectorAll('button.order').forEach(button => {
        button.addEventListener('click', () => {
            submitChatMessage(button.textContent);
        });
    });

    // --- Delegación para elementos con data-solicitud ---
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-solicitud]');
        if (!btn) return;

        e.preventDefault();

        const solicitud = btn.getAttribute('data-solicitud');
        if (solicitud) {
            const parts = solicitud.split('#');
            if (parts.length === 3 && parts[0] === 'ecliente') {
                const [, entidad, id] = parts;
                window.open(`${eclienteUrl}/access/${entidad}/${userToken}/${id}`);
                return;
            }
            // Si no es ecliente, enviar texto al chat
            submitChatMessage(solicitud);
        }
    });

    // --- Funciones reutilizables ---
    function submitChatMessage(text) {
        const chatInput = document.getElementById('chat-message');
        chatInput.value = text;

        const chatForm = document.getElementById('chat-form');
        chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    function addMessageToChat(type, message, thinking = false) {
        const chatBox = document.getElementById('chat-box');
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', type);
        if (thinking) messageDiv.classList.add('thinking');

        const textDiv = document.createElement('div');
        textDiv.classList.add('text');
        if (type === 'bot') textDiv.classList.add('w-100');
        textDiv.innerHTML = message;

        messageDiv.appendChild(textDiv);
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;

        // Reproducir sonido si es mensaje de bot y no está "pensando"
        if (type === 'bot' && !thinking) {
            const audio = document.getElementById('notificationSound');
            if (audio) {
                audio.currentTime = 0;  // reiniciar audio para que suene siempre
                audio.play().catch(e => {
                    // En caso de error (ej. sin interacción previa), no hacer nada
                    console.warn("No se pudo reproducir el sonido", e);
                });
            }
        }
    }

    function addMessageToChatThinking() {
        const thinkingHTML = `
            <div id="loading" class="d-flex align-items-center">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>`;
        addMessageToChat('bot', thinkingHTML, true);
    }

    function removeThinkingMessage() {
        document.querySelectorAll('.thinking').forEach(el => el.remove());
    }

    function showApiError(msg) {
        const errorDiv = document.getElementById('api-errors');
        errorDiv.textContent = msg;
        errorDiv.classList.remove('d-none');
    }

    function clearApiError() {
        const errorDiv = document.getElementById('api-errors');
        if (!errorDiv.classList.contains('d-none')) {
            errorDiv.classList.add('d-none');
        }
    }
});
