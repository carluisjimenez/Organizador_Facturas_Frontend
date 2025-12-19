// Estado de la aplicación
let state = {
    selectedFile: null,
    groups: [],
    currentPreviewGroup: null,
    currentPreviewPdfs: [],
    pdfToMoveIndex: null,
    pdfsToMoveToNewGroup: new Set(), // Almacena IDs o índices
    sessionId: null,
    apiBaseUrl: 'https://organizadorfacturasbe.onrender.com',
    backendActivation: {
        timerInterval: null,
        inactivityTimeout: null,
        isActivated: false
    }
};

// Elementos del DOM
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const groupsTableBody = document.getElementById('groupsTableBody');
const previewModal = document.getElementById('previewModal');
const closeModal = document.getElementById('closeModal');
const cancelPreview = document.getElementById('cancelPreview');
const savePreview = document.getElementById('savePreview');
const processingOverlay = document.getElementById('processingOverlay');
const uploadContent = document.getElementById('uploadContent');
const serviceOverlay = document.getElementById('serviceOverlay');

const previewTotalPdfs = document.getElementById('previewTotalPdfs');
const previewZone = document.getElementById('previewZone');
const pdfsList = document.getElementById('pdfsList');
const previewFileInput = document.getElementById('previewFileInput');
const movePdfModal = document.getElementById('movePdfModal');
const moveGroupSearch = document.getElementById('moveGroupSearch');
const moveGroupsList = document.getElementById('moveGroupsList');
const splitGroupModal = document.getElementById('splitGroupModal');
const splitGroupName = document.getElementById('splitGroupName');
const splitGroupPdfList = document.getElementById('splitGroupPdfList');
const previewGroupNameInput = document.getElementById('previewGroupNameInput');
const previewGroupNameText = document.getElementById('previewGroupNameText');
const editGroupNameBtn = document.getElementById('editGroupNameBtn');

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    ensureBackendAwake(); // Despertar backend automáticamente al cargar
});

// Inicializar event listeners
function initializeEventListeners() {
    // Zona de carga
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', handleDragOver);
    uploadZone.addEventListener('dragleave', handleDragLeave);
    uploadZone.addEventListener('drop', handleDrop);

    fileInput.addEventListener('change', handleFileSelect);

    // Modal
    closeModal.addEventListener('click', async () => {
        await handleSavePreview();
        closePreviewModal();
    });
    cancelPreview.addEventListener('click', closePreviewModal);
    savePreview.addEventListener('click', handleSavePreview);

    // Cerrar modal al hacer clic fuera
    previewModal.addEventListener('click', async (e) => {
        if (e.target === previewModal) {
            await handleSavePreview();
            closePreviewModal();
        }
    });

    // Cerrar modal de crear grupo al hacer clic fuera
    const addGroupModal = document.getElementById('addGroupModal');
    if (addGroupModal) {
        addGroupModal.addEventListener('click', (e) => {
            if (e.target === addGroupModal) {
                closeAddGroupDialog();
            }
        });
    }

    // Crear grupo al presionar Enter en el input de nombre
    const newGroupNameInput = document.getElementById('newGroupName');
    if (newGroupNameInput) {
        newGroupNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                createNewGroup();
            }
        });
    }


    // Zona de preview para agregar PDFs
    previewZone.addEventListener('dragover', handlePreviewDragOver);
    previewZone.addEventListener('dragleave', handlePreviewDragLeave);
    previewZone.addEventListener('drop', handlePreviewDrop);

    // Clic en zona de preview para seleccionar archivos
    previewZone.addEventListener('click', (e) => {
        // Evitar que se active si se hizo clic en un hijo que no queremos (aunque previewZone está vacío generalmente)
        previewFileInput.click();
    });

    // Filtro de grupos en modal de mover
    if (moveGroupSearch) {
        moveGroupSearch.addEventListener('input', (e) => {
            renderMoveGroupsList(e.target.value);
        });
    }

    if (previewFileInput) {
        previewFileInput.addEventListener('change', handlePreviewFileSelect);
    }

    if (previewGroupNameInput) {
        previewGroupNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                saveEditedGroupName();
            }
        });
    }
}

// Manejo de drag and drop en zona de carga
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('dragover');
}

async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('dragover');

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
        showLoading();
        try {
            const files = [];

            // Función recursiva para recorrer entradas de archivos/directorios
            async function traverseEntry(entry) {
                if (entry.isFile) {
                    const file = await new Promise((resolve) => entry.file(resolve));
                    const fileName = file.name.toLowerCase();
                    if (fileName.endsWith('.pdf') || fileName.endsWith('.zip')) {
                        files.push(file);
                    }
                } else if (entry.isDirectory) {
                    const reader = entry.createReader();
                    const readAllEntries = async () => {
                        const entries = await new Promise((resolve) => reader.readEntries(resolve));
                        if (entries.length > 0) {
                            for (const subEntry of entries) {
                                await traverseEntry(subEntry);
                            }
                            await readAllEntries(); // Seguir leyendo por si hay más de 100 entries
                        }
                    };
                    await readAllEntries();
                }
            }

            // Procesar todos los items arrastrados
            const traversePromises = [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry();
                if (entry) {
                    traversePromises.push(traverseEntry(entry));
                }
            }

            await Promise.all(traversePromises);

            if (files.length > 0) {
                await handleAnalyzeMultiple(files);
            } else {
                showMessage('No se encontraron archivos PDF o ZIP válidos', 'error');
            }
        } catch (error) {
            console.error('Error al procesar archivos arrastrados:', error);
            showMessage('Error al procesar los archivos', 'error');
        } finally {
            hideLoading();
        }
    } else {
        // Fallback para navegadores que no soportan DataTransferItem
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const validFiles = Array.from(files).filter(file => {
                const fileName = file.name.toLowerCase();
                return fileName.endsWith('.zip') || fileName.endsWith('.pdf');
            });

            if (validFiles.length > 0) {
                showLoading();
                await handleAnalyzeMultiple(validFiles);
                hideLoading();
            }
        }
    }
}

async function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        const validFiles = Array.from(files).filter(file => {
            const fileName = file.name.toLowerCase();
            const isValidExtension = fileName.endsWith('.zip') || fileName.endsWith('.pdf');
            const isValidMime = file.type === 'application/zip' ||
                file.type === 'application/x-zip-compressed' ||
                file.type === 'application/pdf' ||
                file.type === '';
            return isValidExtension || isValidMime;
        });

        if (validFiles.length > 0) {
            showLoading();
            await handleAnalyzeMultiple(validFiles);
            hideLoading();
        } else {
            showMessage('Por favor, selecciona archivos ZIP o PDF válidos', 'error');
        }
        // Limpiar el input para permitir seleccionar los mismos archivos de nuevo
        e.target.value = '';
    }
}

// Analizar archivo ZIP o PDF
async function handleAnalyze(file) {
    if (!file) {
        showMessage('Por favor, selecciona un archivo ZIP o PDF primero', 'error');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('file', file);

        // Si hay una sesión activa, enviarla para reutilizar
        if (state.sessionId) {
            formData.append('session_id', state.sessionId);
        }

        // Usar el mismo endpoint para ZIPs y PDFs - el backend debe manejar ambos
        const response = await fetch(`${state.apiBaseUrl}/api/analyze`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al analizar el archivo');
        }

        const data = await response.json();

        // Reset inactivity timer since we successfully talked to backend
        resetInactivityTimer();

        // Mantener grupos manuales y agregar nuevos grupos organizados
        const manualGroups = state.groups.filter(g => g.created_by === 'manual');
        const newGroups = data.groups.filter(g => !state.groups.some(sg => sg.id === g.id));
        state.groups = [...manualGroups, ...newGroups];
        state.sessionId = data.session_id;

        renderGroupsTable();
        showMessage('Archivos analizados correctamente', 'success');
    } catch (error) {
        console.error('Error al analizar:', error);
        showMessage(error.message || 'Error al analizar el archivo. Por favor, intenta de nuevo.', 'error');
    }
}

async function handleAnalyzeMultiple(files) {
    if (!files || files.length === 0) {
        showMessage('Por favor, selecciona archivos ZIP o PDF', 'error');
        return;
    }

    let processedCount = 0;
    for (const file of files) {
        try {
            await handleAnalyze(file);
            processedCount++;
        } catch (error) {
            console.error('Error al analizar archivo:', file.name, error);
            // Continuar con el siguiente archivo
        }
    }

    if (processedCount > 0) {
        showMessage('Archivos analizados correctamente', 'success');
    } else {
        showMessage('No se pudo analizar ningún archivo', 'error');
    }
}

// Funciones para mostrar/ocultar estados de carga
function showLoading() {
    if (processingOverlay) processingOverlay.style.display = 'flex';
    if (uploadContent) uploadContent.style.visibility = 'hidden';
}

function hideLoading() {
    if (processingOverlay) processingOverlay.style.display = 'none';
    if (uploadContent) uploadContent.style.visibility = 'visible';
}


// Renderizar tabla de grupos
function renderGroupsTable() {
    groupsTableBody.innerHTML = '';

    // Ordenar grupos alfabéticamente por nombre de grupo
    state.groups.sort((a, b) => a.baseName.localeCompare(b.baseName));

    // Habilitar/deshabilitar botones según si hay grupos
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    const deleteAllBtn = document.getElementById('deleteAllBtn');

    if (state.groups.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="3" style="text-align: center; padding: 40px; color: #999;">No hay grupos disponibles. Analiza un archivo ZIP o PDF para comenzar.</td>';
        groupsTableBody.appendChild(row);

        // Deshabilitar botones cuando no hay grupos
        if (downloadAllBtn) downloadAllBtn.disabled = true;
        if (deleteAllBtn) deleteAllBtn.disabled = true;
        return;
    }

    // Habilitar botones cuando hay grupos
    if (downloadAllBtn) downloadAllBtn.disabled = false;
    if (deleteAllBtn) deleteAllBtn.disabled = false;

    state.groups.forEach(group => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div class="base-name-container">
                    <span class="base-name-text" id="baseName_${group.id}">${group.baseName}</span>
                    <div class="base-name-edit-container" id="baseNameEdit_${group.id}" style="display: none;">
                        <input type="text" class="base-name-input" id="baseNameInput_${group.id}" value="${group.baseName}">
                        <button class="btn-confirm-name" onclick="confirmBaseName(${group.id})" title="Confirmar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                        <button class="btn-cancel-name" onclick="cancelEditBaseName(${group.id})" title="Cancelar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <button class="btn-edit-name" onclick="editBaseName(${group.id})" title="Editar nombre">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </td>
            <td>${group.pdfs.length}</td>
            <td>
                <button class="btn-action btn-preview" onclick="openPreview(${group.id})">Ver</button>
                <button class="btn-action btn-download" onclick="downloadGroup(${group.id})">Descargar</button>
                <button class="btn-action btn-delete-group" onclick="deleteGroup(${group.id})" title="Eliminar grupo">Eliminar</button>
            </td>
        `;
        groupsTableBody.appendChild(row);
    });
}

// Abrir vista para ver grupo
function openPreview(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;

    state.currentPreviewGroup = group;
    state.currentPreviewPdfs = [...group.pdfs]; // Copia para editar

    if (previewGroupNameInput) {
        previewGroupNameInput.value = group.baseName;
        // Reiniciar estado de la vista
        previewGroupNameInput.style.display = 'none';
        if (previewGroupNameText) {
            previewGroupNameText.textContent = group.baseName;
            previewGroupNameText.style.display = 'inline';
        }
        if (editGroupNameBtn) editGroupNameBtn.style.display = 'inline-flex';
    }
    // previewGroupName.textContent = group.baseName; // Eliminado ya que el elemento es reemplazado
    previewTotalPdfs.textContent = state.currentPreviewPdfs.length;

    renderPreviewPdfs();
    previewModal.classList.add('show');
}

// Renderizar PDFs para ver
function renderPreviewPdfs() {
    pdfsList.innerHTML = '';

    if (state.currentPreviewPdfs.length === 0) {
        pdfsList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No hay PDFs en este grupo</p>';
        return;
    }

    state.currentPreviewPdfs.forEach((pdf, index) => {
        const pdfItem = createPdfItem(pdf, index);
        pdfsList.appendChild(pdfItem);
    });
}

// Crear elemento de PDF en la lista
function createPdfItem(pdf, index) {
    const item = document.createElement('div');
    item.className = 'pdf-item';
    item.draggable = true;
    item.dataset.index = index;
    item.dataset.pdfId = pdf.id || pdf.name;

    item.innerHTML = `
        <div class="pdf-info">
            <svg class="pdf-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
            </svg>
            <span class="pdf-name clickable" onclick="openPdfInBrowser(${index})" title="Haz clic para abrir el PDF">${pdf.name}</span>
        </div>
        <div class="pdf-controls">
            <button class="btn-primary" onclick="openMovePdfModal(${index})" style="padding: 5px 12px; margin-right: 5px; font-size: 0.9em;">Mover</button>
            <button class="btn-red-stylish" onclick="deletePdfFromPreview(${index})" style="padding: 5px 12px; font-size: 0.9em;">Eliminar</button>
        </div>
    `;

    // Drag and drop para reordenar
    item.addEventListener('dragstart', handlePdfDragStart);
    item.addEventListener('dragover', handlePdfDragOver);
    item.addEventListener('drop', handlePdfDrop);
    item.addEventListener('dragend', handlePdfDragEnd);

    return item;
}

// Funciones de movimiento de PDFs
function openMovePdfModal(index) {
    state.pdfToMoveIndex = index;
    moveGroupSearch.value = '';
    renderMoveGroupsList();
    movePdfModal.classList.add('show');
    moveGroupSearch.focus();
}

function closeMovePdfModal() {
    movePdfModal.classList.remove('show');
    state.pdfToMoveIndex = null;
}

function renderMoveGroupsList(filterText = '') {
    moveGroupsList.innerHTML = '';
    const filter = filterText.toLowerCase().trim();

    // Filtrar grupos (excluyendo el actual)
    const groupsToShow = state.groups.filter(g => {
        if (state.currentPreviewGroup && g.id === state.currentPreviewGroup.id) return false;
        return g.baseName.toLowerCase().includes(filter);
    });

    if (groupsToShow.length === 0) {
        moveGroupsList.innerHTML = '<li style="padding: 15px; text-align: center; color: #777;">No se encontraron grupos</li>';
        return;
    }

    groupsToShow.forEach(group => {
        const li = document.createElement('li');
        li.style.cssText = 'padding: 10px 15px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center;';
        li.innerHTML = `
            <span style="font-weight: 500;">${group.baseName}</span>
            <span style="font-size: 0.85em; color: #666; background: #f0f0f0; padding: 2px 6px; border-radius: 4px;">${group.pdfs.length} PDFs</span>
        `;
        li.onclick = () => movePdfToGroup(group.id);
        li.onmouseover = () => li.style.backgroundColor = '#f9f9f9';
        li.onmouseout = () => li.style.backgroundColor = 'transparent';
        moveGroupsList.appendChild(li);
    });
}

async function movePdfToGroup(targetGroupId) {
    if (state.pdfToMoveIndex === null) return;

    try {
        const targetGroup = state.groups.find(g => g.id === targetGroupId);
        if (!targetGroup) throw new Error("Grupo destino no encontrado");

        // Obtener el PDF a mover
        const pdfToMove = state.currentPreviewPdfs[state.pdfToMoveIndex];

        // 1. Añadir al grupo destino (en local state)
        // Clonamos para no tener referencias compartidas extrañas, aunque si es objeto File se mantiene
        const pdfForTarget = { ...pdfToMove };

        let targetPdfs = [...targetGroup.pdfs];
        targetPdfs.push(pdfForTarget);

        // 2. Remover del grupo actual (en local state)
        state.currentPreviewPdfs.splice(state.pdfToMoveIndex, 1);

        showMessage(`Moviendo PDF a ${targetGroup.baseName}...`, 'info');
        closeMovePdfModal(); // Cerrar modal inmediatamente

        // 3. Guardar cambios en AMBOS grupos
        // Importante: Guardar el grupo actual primero para asegurar que se quita
        await saveGroup(state.currentPreviewGroup, state.currentPreviewPdfs);

        // Luego guardar el grupo destino
        await saveGroup(targetGroup, targetPdfs);

        // Actualizar UI
        previewTotalPdfs.textContent = state.currentPreviewPdfs.length;
        renderPreviewPdfs();

        showSuccessNotification('PDF Movido');
        showMessage(`PDF movido exitosamente a ${targetGroup.baseName}`, 'success');

    } catch (error) {
        console.error('Error al mover PDF:', error);
        showMessage(error.message || 'Error al mover el PDF', 'error');
        // Si falla, podríamos necesitar recargar los grupos para asegurar consistencia
        // Pero por ahora solo mostramos error
    }
}

function deletePdfFromPreview(index) {
    state.currentPreviewPdfs.splice(index, 1);
    previewTotalPdfs.textContent = state.currentPreviewPdfs.length;
    renderPreviewPdfs();
}

// Drag and drop para reordenar PDFs
let draggedPdfIndex = null;

function handlePdfDragStart(e) {
    draggedPdfIndex = parseInt(e.target.dataset.index);
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handlePdfDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const item = e.target.closest('.pdf-item');
    if (item && item.dataset.index !== draggedPdfIndex.toString()) {
        item.classList.add('drag-over');
    }
}

function handlePdfDrop(e) {
    e.preventDefault();
    const targetItem = e.target.closest('.pdf-item');
    if (!targetItem) return;

    const targetIndex = parseInt(targetItem.dataset.index);
    if (draggedPdfIndex !== null && draggedPdfIndex !== targetIndex) {
        const [movedPdf] = state.currentPreviewPdfs.splice(draggedPdfIndex, 1);
        state.currentPreviewPdfs.splice(targetIndex, 0, movedPdf);
        renderPreviewPdfs();
    }
}

function handlePdfDragEnd(e) {
    e.target.classList.remove('dragging');
    document.querySelectorAll('.pdf-item').forEach(item => {
        item.classList.remove('drag-over');
    });
    draggedPdfIndex = null;
}

// Manejo de drag and drop en zona de preview para agregar PDFs
function handlePreviewDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    previewZone.classList.add('dragover');
}

function handlePreviewDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    previewZone.classList.remove('dragover');
}

async function handlePreviewDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    previewZone.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        addMultiplePdfsToPreview(files);
    }
}

function handlePreviewFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        addMultiplePdfsToPreview(files);
        e.target.value = ''; // Limpiar para permitir seleccionar los mismos archivos
    }
}

function addMultiplePdfsToPreview(files) {
    let addedCount = 0;
    for (const file of Array.from(files)) {
        if (file.name.toLowerCase().endsWith('.pdf')) {
            // Para PDFs nuevos, creamos un objeto temporal
            const newPdf = {
                id: Date.now() + Math.random(),
                name: file.name,
                isNew: true,
                file: file // Guardar el archivo para cuando se guarde
            };
            state.currentPreviewPdfs.push(newPdf);
            addedCount++;
        }
    }

    if (addedCount > 0) {
        showSuccessNotification('Agregado');
        previewTotalPdfs.textContent = state.currentPreviewPdfs.length;
        renderPreviewPdfs();
        showMessage(`${addedCount} PDF(s) agregado(s) al grupo`, 'success');
    } else {
        const hasNonPdf = Array.from(files).some(f => !f.name.toLowerCase().endsWith('.pdf'));
        if (hasNonPdf) {
            showMessage('Solo se permiten archivos PDF', 'warning');
        }
    }
}

// Guardar cambios al ver grupo
async function handleSavePreview() {
    if (!state.currentPreviewGroup) return;

    // Nombre actualizado
    const newName = previewGroupNameInput.value.trim();
    if (newName && newName !== state.currentPreviewGroup.baseName) {
        state.currentPreviewGroup.baseName = newName;
        // No guardar todavía, se guardará en saveGroup
    }

    try {
        await saveGroup(state.currentPreviewGroup, state.currentPreviewPdfs);
        closePreviewModal();
        showMessage('Cambios guardados correctamente', 'success');
    } catch (error) {
        console.error('Error al guardar:', error);
        showMessage(error.message || 'Error al guardar los cambios', 'error');
    }
}

// Función genérica para guardar un grupo
async function saveGroup(group, pdfs) {
    // Separar PDFs nuevos de los existentes
    const newPdfs = pdfs.filter(pdf => pdf.isNew);

    let response;

    if (newPdfs.length > 0) {
        // Si hay PDFs nuevos, usar FormData para subirlos
        const formData = new FormData();

        newPdfs.forEach((pdf, index) => {
            if (pdf.file) {
                // Usamos un índice único para evitar colisiones si hay múltiples nuevos
                formData.append(`pdf_${index}`, pdf.file);
            }
        });

        // Agregar el orden/lista de todos los PDFs (viejos y nuevos)
        formData.append('pdfs_order', JSON.stringify(pdfs.map(p => ({
            id: p.id,
            name: p.name,
            isNew: p.isNew || false
        }))));

        // También enviar baseName en caso de que haya cambiado
        formData.append('baseName', group.baseName);

        response = await fetch(`${state.apiBaseUrl}/api/groups/${group.id}`, {
            method: 'PUT',
            body: formData
        });
    } else {
        // Solo actualizar orden/eliminar PDFs existentes + nombre
        response = await fetch(`${state.apiBaseUrl}/api/groups/${group.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pdfs: pdfs,
                baseName: group.baseName
            })
        });
    }

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al guardar el grupo ' + group.baseName);
    }

    const updatedGroup = await response.json();

    // Reset inactivity timer
    resetInactivityTimer();

    // Actualizar el grupo en el estado local
    const groupIndex = state.groups.findIndex(g => g.id === group.id);
    if (groupIndex !== -1) {
        state.groups[groupIndex] = updatedGroup;
    }

    // Si estamos viendo este grupo, actualizar referencia
    if (state.currentPreviewGroup && state.currentPreviewGroup.id === group.id) {
        state.currentPreviewGroup = updatedGroup;
        // No sobrescribimos currentPreviewPdfs aquí porque podría romper la edición en curso si se llama parcialmente,
        // pero en este flujo saveGroup se llama al finalizar.
    }

    renderGroupsTable();
    return updatedGroup;
}

// Cerrar modal para ver grupo
function closePreviewModal() {
    previewModal.classList.remove('show');
    state.currentPreviewGroup = null;
    state.currentPreviewPdfs = [];
}

// Descargar grupo
async function downloadGroup(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;

    try {
        showMessage(`Descargando grupo: ${group.baseName}...`, 'info');

        const response = await fetch(`${state.apiBaseUrl}/api/download/${groupId}`, {
            method: 'GET'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al descargar el grupo');
        }

        const blob = await response.blob();

        // Reset inactivity timer
        resetInactivityTimer();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${group.baseName}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showMessage(`Grupo ${group.baseName} descargado correctamente`, 'success');
    } catch (error) {
        console.error('Error al descargar:', error);
        showMessage(error.message || 'Error al descargar el grupo. Por favor, intenta de nuevo.', 'error');
    }
}

// Mostrar mensaje
function showMessage(text, type = 'info') {
    // Eliminar mensaje anterior si existe
    const existingMessage = document.querySelector('.message');
    if (existingMessage) {
        existingMessage.remove();
    }

    const message = document.createElement('div');
    message.className = `message ${type}`;
    message.textContent = text;

    document.body.appendChild(message);

    // Animación de entrada
    setTimeout(() => {
        message.classList.add('show');
    }, 10);

    // Auto-eliminar después de 5 segundos
    setTimeout(() => {
        message.classList.remove('show');
        setTimeout(() => {
            message.remove();
        }, 300);
    }, 5000);
}

// Mostrar notificación de éxito temporal
function showSuccessNotification(text) {
    // Eliminar notificación anterior si existe
    const existingNotification = document.querySelector('.success-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'success-notification';
    notification.innerHTML = `
        <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>${text}</span>
    `;

    document.body.appendChild(notification);

    // Animación de entrada
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    // Auto-eliminar después de 2 segundos
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 2000);
}


// Editar nombre base del grupo
function editBaseName(groupId) {
    const nameText = document.getElementById(`baseName_${groupId}`);
    const editContainer = document.getElementById(`baseNameEdit_${groupId}`);
    const nameInput = document.getElementById(`baseNameInput_${groupId}`);

    if (nameText && editContainer && nameInput) {
        nameText.style.display = 'none';
        editContainer.style.display = 'flex';
        nameInput.focus();
        requestAnimationFrame(() => {
            try {
                const len = nameInput.value.length;
                nameInput.setSelectionRange(len, len);
            } catch (e) {
                // ignore
            }
        });

        // Añadir event listener para Enter y Escape
        nameInput.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                confirmBaseName(groupId);
            } else if (event.key === 'Escape') {
                cancelEditBaseName(groupId);
            }
        });
    }
}

// Confirmar nombre base del grupo
async function confirmBaseName(groupId) {
    const nameText = document.getElementById(`baseName_${groupId}`);
    const editContainer = document.getElementById(`baseNameEdit_${groupId}`);
    const nameInput = document.getElementById(`baseNameInput_${groupId}`);
    const group = state.groups.find(g => g.id === groupId);

    if (!nameText || !editContainer || !nameInput || !group) return;

    const newName = nameInput.value.trim();

    if (newName === group.baseName) {
        // No hay cambios, solo cancelar edición
        cancelEditBaseName(groupId);
        return;
    }

    if (newName === '') {
        showMessage('El nombre no puede estar vacío', 'error');
        return;
    }

    try {
        const response = await fetch(`${state.apiBaseUrl}/api/groups/${groupId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                baseName: newName
            })
        });

        // Verificar el Content-Type antes de parsear JSON
        const contentType = response.headers.get('content-type');

        if (!response.ok) {
            let errorMessage = 'Error al actualizar el nombre';
            if (contentType && contentType.includes('application/json')) {
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (e) {
                    // Si no se puede parsear JSON, usar el texto de la respuesta
                    const text = await response.text();
                    errorMessage = text || errorMessage;
                }
            } else {
                const text = await response.text();
                errorMessage = text || errorMessage;
            }
            throw new Error(errorMessage);
        }

        let updatedGroup;
        if (contentType && contentType.includes('application/json')) {
            try {
                updatedGroup = await response.json();
            } catch (e) {
                // Si falla el parseo JSON, actualizar solo localmente
                console.warn('No se pudo parsear la respuesta JSON, actualizando localmente');
                updatedGroup = { ...group, baseName: newName };
            }
        } else {
            // Si no es JSON, actualizar solo localmente
            updatedGroup = { ...group, baseName: newName };
        }

        // Actualizar el grupo en el estado local
        const groupIndex = state.groups.findIndex(g => g.id === groupId);
        if (groupIndex !== -1) {
            state.groups[groupIndex] = updatedGroup;

            // Si el grupo está siendo visto, actualizar también
            if (state.currentPreviewGroup && state.currentPreviewGroup.id === groupId) {
                state.currentPreviewGroup.baseName = newName;
                previewGroupName.textContent = newName;
            }

            // Re-renderizar la tabla para actualizar el nombre
            renderGroupsTable();
            showMessage('Nombre actualizado correctamente', 'success');
        }
    } catch (error) {
        console.error('Error al actualizar nombre:', error);
        showMessage(error.message || 'Error al actualizar el nombre. Por favor, intenta de nuevo.', 'error');
    }
}

// Cancelar edición de nombre base
function cancelEditBaseName(groupId) {
    const nameText = document.getElementById(`baseName_${groupId}`);
    const editContainer = document.getElementById(`baseNameEdit_${groupId}`);
    const nameInput = document.getElementById(`baseNameInput_${groupId}`);
    const group = state.groups.find(g => g.id === groupId);

    if (nameText && editContainer && nameInput && group) {
        nameInput.value = group.baseName;
        nameText.style.display = 'inline';
        editContainer.style.display = 'none';
    }
}

// Abrir PDF en el navegador
function openPdfInBrowser(index) {
    const pdf = state.currentPreviewPdfs[index];
    if (!pdf) return;

    let pdfUrl;
    if (pdf.file) {
        // PDF nuevo que el usuario tiene en su ordenador
        pdfUrl = URL.createObjectURL(pdf.file);
        window.open(pdfUrl, '_blank');
        // Limpiar la URL después de un tiempo (dar tiempo al navegador para abrir)
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000); // 60 segundos
    } else if (pdf.id) {
        // PDF existente del servidor - intentar descargarlo y abrirlo
        fetch(`${state.apiBaseUrl}/api/pdf/${pdf.id}`)
            .then(response => {
                if (!response.ok) throw new Error('Error al obtener el PDF');
                return response.blob();
            })
            .then(blob => {
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
                // Limpiar la URL después de un tiempo
                setTimeout(() => URL.revokeObjectURL(url), 60000); // 60 segundos
            })
            .catch(error => {
                console.error('Error al abrir PDF:', error);
                showMessage('No se puede abrir el PDF', 'error');
            });
    } else {
        showMessage('No se puede abrir el PDF', 'error');
    }
}

// Eliminar grupo
async function deleteGroup(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;

    try {
        const response = await fetch(`${state.apiBaseUrl}/api/groups/${groupId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al eliminar el grupo');
        }

        // Eliminar el grupo del estado local
        state.groups = state.groups.filter(g => g.id !== groupId);
        renderGroupsTable();
        showMessage('Grupo eliminado correctamente', 'success');
    } catch (error) {
        console.error('Error al eliminar grupo:', error);
        showMessage(error.message || 'Error al eliminar el grupo. Por favor, intenta de nuevo.', 'error');
    }
}

// Mostrar diálogo para crear nuevo grupo
function showAddGroupDialog() {
    const modal = document.getElementById('addGroupModal');
    const input = document.getElementById('newGroupName');
    if (modal && input) {
        input.value = '';
        modal.classList.add('show');
        input.focus();
    }
}

// Cerrar diálogo de crear nuevo grupo
function closeAddGroupDialog() {
    const modal = document.getElementById('addGroupModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// Crear nuevo grupo
async function createNewGroup() {
    const input = document.getElementById('newGroupName');
    if (!input) return;

    const groupName = input.value.trim();

    if (groupName === '') {
        showMessage('El nombre del grupo no puede estar vacío', 'error');
        return;
    }

    try {
        const response = await fetch(`${state.apiBaseUrl}/api/groups`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                baseName: groupName,
                pdfs: []
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al crear el grupo');
        }

        const newGroup = await response.json();

        // Reset inactivity timer
        resetInactivityTimer();

        newGroup.created_by = 'manual'; // Marcar como creado manualmente
        state.groups.push(newGroup);
        renderGroupsTable();
        closeAddGroupDialog();
        showMessage('Grupo creado correctamente', 'success');
    } catch (error) {
        console.error('Error al crear grupo:', error);
        showMessage(error.message || 'Error al crear el grupo. Por favor, intenta de nuevo.', 'error');
    }
}

// Descargar todos los grupos como un solo ZIP
async function downloadAllGroups() {
    if (state.groups.length === 0) {
        showMessage('No hay grupos para descargar', 'error');
        return;
    }

    if (!state.sessionId) {
        showMessage('No hay una sesión activa para descargar', 'error');
        return;
    }

    try {
        showMessage('Preparando descarga de todas las facturas...', 'info');

        const response = await fetch(`${state.apiBaseUrl}/api/download-all?session_id=${state.sessionId}`, {
            method: 'GET'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al descargar todas las facturas');
        }

        const blob = await response.blob();

        // Reset inactivity timer
        resetInactivityTimer();

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `facturas_organizadas.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showMessage(`Facturas descargadas correctamente en un archivo ZIP`, 'success');
    } catch (error) {
        console.error('Error al descargar ZIP:', error);
        showMessage(error.message || 'Error al descargar el archivo ZIP. Por favor, intenta de nuevo.', 'error');
    }
}

// Eliminar todos los grupos
async function deleteAllGroups() {
    if (state.groups.length === 0) {
        showMessage('No hay grupos para eliminar', 'error');
        return;
    }

    const totalGroups = state.groups.length;

    try {
        showMessage('Eliminando todos los grupos...', 'info');

        // Eliminar cada grupo
        const deletePromises = state.groups.map(async (group) => {
            try {
                const response = await fetch(`${state.apiBaseUrl}/api/groups/${group.id}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Error al eliminar grupo ${group.baseName}`);
                }

                return true;
            } catch (error) {
                console.error(`Error al eliminar grupo ${group.baseName}:`, error);
                return false;
            }
        });

        const results = await Promise.all(deletePromises);
        const successCount = results.filter(r => r === true).length;

        // Actualizar el estado local removiendo todos los grupos
        state.groups = [];
        renderGroupsTable();

        if (successCount === totalGroups) {
            showMessage('Todos los grupos fueron eliminados correctamente', 'success');
        } else {
            showMessage(`Se eliminaron ${successCount} de ${totalGroups} grupo(s)`, 'warning');
        }
    } catch (error) {
        console.error('Error al eliminar grupos:', error);
        showMessage('Error al eliminar los grupos. Por favor, intenta de nuevo.', 'error');
    }
}

// Funciones globales para los botones
window.openPreview = openPreview;
window.downloadGroup = downloadGroup;
window.deletePdfFromPreview = deletePdfFromPreview;
window.editBaseName = editBaseName;
window.confirmBaseName = confirmBaseName;
window.cancelEditBaseName = cancelEditBaseName;
window.openPdfInBrowser = openPdfInBrowser;
window.deleteGroup = deleteGroup;
window.showAddGroupDialog = showAddGroupDialog;
window.closeAddGroupDialog = closeAddGroupDialog;
window.createNewGroup = createNewGroup;
window.downloadAllGroups = downloadAllGroups;
window.deleteAllGroups = deleteAllGroups;

window.openSplitGroupModal = openSplitGroupModal;
window.closeSplitGroupModal = closeSplitGroupModal;
window.createSplitGroup = createSplitGroup;
window.togglePdfSelection = togglePdfSelection;
window.enableEditGroupName = enableEditGroupName;
window.saveEditedGroupName = saveEditedGroupName;

// Funciones para editar nombre en modal
function enableEditGroupName() {
    if (previewGroupNameInput && previewGroupNameText && editGroupNameBtn) {
        previewGroupNameText.style.display = 'none';
        editGroupNameBtn.style.display = 'none';
        previewGroupNameInput.style.display = 'block';
        previewGroupNameInput.focus();
        previewGroupNameInput.setSelectionRange(0, 0);
    }
}

function saveEditedGroupName() {
    if (previewGroupNameInput && previewGroupNameText && editGroupNameBtn) {
        const newName = previewGroupNameInput.value.trim();
        if (newName === '') {
            showMessage('El nombre no puede estar vacío', 'error');
            return;
        }

        // Actualizamos el texto visualmente y el estado interno
        previewGroupNameText.textContent = newName;
        state.currentPreviewGroup.baseName = newName;

        // Restauramos la vista
        previewGroupNameInput.style.display = 'none';
        previewGroupNameText.style.display = 'inline';
        editGroupNameBtn.style.display = 'inline-flex';

        showMessage('Nombre actualizado (Guardar Cambios para confirmar)', 'success');
    }
}

// Funciones para Dividir Grupo (Crear nuevo desde selección)
function openSplitGroupModal() {
    state.pdfsToMoveToNewGroup = new Set();
    splitGroupName.value = '';
    renderSplitGroupList();

    // Cerrar preview modal temporalmente o mantenerlo detras?
    // Mejor mantenerlo detrás pero quizás ocultarlo si hay conflicto de z-index
    // Se asume que el CSS maneja z-index correctamente.
    splitGroupModal.classList.add('show');
}

function closeSplitGroupModal() {
    splitGroupModal.classList.remove('show');
    state.pdfsToMoveToNewGroup.clear();
}

function renderSplitGroupList() {
    splitGroupPdfList.innerHTML = '';
    const countLabel = document.getElementById('splitGroupCount');

    if (state.currentPreviewPdfs.length === 0) {
        splitGroupPdfList.innerHTML = '<li style="padding: 15px; text-align: center;">No hay PDFs disponibles en este grupo.</li>';
        return;
    }

    state.currentPreviewPdfs.forEach((pdf, index) => {
        const isSelected = state.pdfsToMoveToNewGroup.has(index);

        const li = document.createElement('li');
        li.style.cssText = `
            padding: 10px 15px; 
            border-bottom: 1px solid #eee; 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            background-color: ${isSelected ? '#f0f9ff' : 'transparent'};
        `;

        li.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: #e11d48; flex-shrink: 0;">
                    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
                </svg>
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${pdf.name}">${pdf.name}</span>
            </div>
            <button class="btn-action" 
                onclick="togglePdfSelection(${index})"
                style="
                    padding: 5px 12px; 
                    font-size: 0.85em; 
                    border-radius: 4px;
                    border: 1px solid ${isSelected ? '#3b82f6' : '#ccc'};
                    background-color: ${isSelected ? '#3b82f6' : 'white'};
                    color: ${isSelected ? 'white' : '#333'};
                    cursor: pointer;
                    min-width: 80px;
                "
            >
                ${isSelected ? 'Regresar' : 'Mover'}
            </button>
        `;

        splitGroupPdfList.appendChild(li);
    });

    if (countLabel) {
        countLabel.textContent = `${state.pdfsToMoveToNewGroup.size} archivos seleccionados`;
    }
}

function togglePdfSelection(index) {
    if (state.pdfsToMoveToNewGroup.has(index)) {
        state.pdfsToMoveToNewGroup.delete(index);
    } else {
        state.pdfsToMoveToNewGroup.add(index);
    }
    renderSplitGroupList();
}

async function createSplitGroup() {
    const newName = splitGroupName.value.trim();
    if (!newName) {
        showMessage('Por favor ingresa un nombre para el nuevo grupo', 'error');
        return;
    }

    if (state.pdfsToMoveToNewGroup.size === 0) {
        showMessage('Selecciona al menos un PDF para mover', 'warning');
        return;
    }

    try {
        showMessage(`Creando grupo "${newName}"...`, 'info');

        // 1. Crear el nuevo grupo (vacio o con los pdfs si la API lo permite, pero nuestra API create espera baseName y pdfs array)
        // La API espera pdfs array, pero aqui tenemos objetos. 
        // Vamos a hacerlo en pasos para ser consistente con como lo hicimos antes.

        // PDFs a mover
        const indicesToMove = Array.from(state.pdfsToMoveToNewGroup).sort((a, b) => b - a); // Descendente para splicing facil
        const pdfsToMove = indicesToMove.map(i => state.currentPreviewPdfs[i]); // Obtener referencias antes de eliminar

        // 2. Crear grupo nuevo via API
        // Nota: Si los pdfs tienen ID y ya existen, podemos pasarlos. Si son nuevos (File objects), necesitamos manejarlos.
        // Asumimos que createNewGroup API puede manejar esto, o usamos la logica de mover.

        // Vamos a crear un grupo vacio primero
        const createResponse = await fetch(`${state.apiBaseUrl}/api/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseName: newName, pdfs: [] })
        });

        if (!createResponse.ok) throw new Error('Error al crear el nuevo grupo');
        const newGroup = await createResponse.json();

        // Agregar al estado local para que saveGroup lo encuentre
        state.groups.push(newGroup);

        // 3. Mover los PDFs al nuevo grupo
        // Reutilizamos saveGroup logic para el nuevo grupo
        await saveGroup(newGroup, pdfsToMove);

        // 4. Actualizar el grupo original (Remover los PDFs movidos)
        const pdfsRemaining = state.currentPreviewPdfs.filter((_, index) => !state.pdfsToMoveToNewGroup.has(index));
        state.currentPreviewPdfs = pdfsRemaining;

        // Guardar grupo original
        // Importante: Actualizar el nombre si se cambió en el input antes de dividir
        if (previewGroupNameInput && previewGroupNameInput.value !== state.currentPreviewGroup.baseName) {
            state.currentPreviewGroup.baseName = previewGroupNameInput.value;
        }
        await saveGroup(state.currentPreviewGroup, state.currentPreviewPdfs);

        // 5. Finalizar
        closeSplitGroupModal();
        closePreviewModal(); // Cerramos también el preview porque "el grupo cambió" drásticamente

        renderGroupsTable();
        showMessage(`Grupo "${newName}" creado y archivos movidos exitosamente`, 'success');

    } catch (error) {
        console.error('Error al dividir grupo:', error);
        showMessage(error.message || 'Error al procesar la solicitud', 'error');
    }
}

async function pingBackend(timeoutMs = 2000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        await fetch(`${state.apiBaseUrl}/`, { method: 'GET', signal: controller.signal });
        return true;
    } catch (_) {
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function ensureBackendAwake() {
    const isAwake = await pingBackend(2000);
    if (isAwake) {
        state.backendActivation.isActivated = true;
        return;
    }

    if (serviceOverlay) serviceOverlay.style.display = 'flex';

    const attemptWake = async () => {
        const ok = await pingBackend(2000);
        if (ok) {
            state.backendActivation.isActivated = true;
            localStorage.setItem('lastActivationTime', Date.now().toString());
            if (serviceOverlay) serviceOverlay.style.display = 'none';
            if (state.backendActivation.timerInterval) {
                clearInterval(state.backendActivation.timerInterval);
                state.backendActivation.timerInterval = null;
            }
        }
    };

    if (state.backendActivation.timerInterval) clearInterval(state.backendActivation.timerInterval);
    state.backendActivation.timerInterval = setInterval(attemptWake, 5000);
}

function resetInactivityTimer() {
    localStorage.setItem('lastActivationTime', Date.now().toString());
}
