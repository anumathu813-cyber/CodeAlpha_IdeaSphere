
// ======================================
// IDEASPHERE - FRONTEND JAVASCRIPT
// ======================================

const socket = io();

const ideasFeed = document.getElementById("ideasFeed");
const ideaForm = document.getElementById("ideaForm");
const formMessage = document.getElementById("formMessage");
const liveStatus = document.getElementById("liveStatus");

const authModal = document.getElementById("authModal");
const loginOpen = document.getElementById("loginOpen");
const logoutButton = document.getElementById("logoutButton");

let currentUser = null;
let allPosts = [];

// ======================================
// HELPER FUNCTIONS
// ======================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || data.error || "Something went wrong.");
    }

    return data;
}

function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("error", isError);
}

// ======================================
// SOCKET.IO CONNECTION STATUS
// ======================================

socket.on("connect", () => {
    liveStatus.textContent = "● Live Community";
    liveStatus.className = "live-status connected";
});

socket.on("disconnect", () => {
    liveStatus.textContent = "● Disconnected";
    liveStatus.className = "live-status disconnected";
});

socket.on("connect_error", () => {
    liveStatus.textContent = "● Connection Error";
    liveStatus.className = "live-status disconnected";
});

// ======================================
// NAVIGATION
// ======================================

const navLinks = document.querySelectorAll(".nav-link");

function updateActiveNavigation() {
    const currentHash = window.location.hash || "#home";

    navLinks.forEach(link => {
        link.classList.toggle(
            "active",
            link.getAttribute("href") === currentHash
        );
    });
}

navLinks.forEach(link => {
    link.addEventListener("click", () => {
        navLinks.forEach(item => item.classList.remove("active"));
        link.classList.add("active");
    });
});

window.addEventListener("hashchange", updateActiveNavigation);
updateActiveNavigation();

// ======================================
// AUTHENTICATION MODAL
// ======================================

function openAuthModal() {
    authModal.classList.remove("hidden");
    showLoginTab();
}

function closeAuthModal() {
    authModal.classList.add("hidden");
}

loginOpen.addEventListener("click", openAuthModal);

document.getElementById("closeAuth").addEventListener("click", closeAuthModal);

authModal.addEventListener("click", event => {
    if (event.target === authModal) {
        closeAuthModal();
    }
});

function showLoginTab() {
    document.getElementById("loginForm").classList.remove("hidden");
    document.getElementById("registerForm").classList.add("hidden");

    document.getElementById("showLogin").classList.add("selected");
    document.getElementById("showRegister").classList.remove("selected");

    document.getElementById("authHeading").textContent = "Welcome Back";
    document.getElementById("authDescription").textContent =
        "Login to participate in IdeaSphere.";
}

function showRegisterTab() {
    document.getElementById("loginForm").classList.add("hidden");
    document.getElementById("registerForm").classList.remove("hidden");

    document.getElementById("showRegister").classList.add("selected");
    document.getElementById("showLogin").classList.remove("selected");

    document.getElementById("authHeading").textContent = "Create Account";
    document.getElementById("authDescription").textContent =
        "Join the IdeaSphere student community.";
}

document.getElementById("showLogin").addEventListener("click", showLoginTab);
document.getElementById("showRegister").addEventListener("click", showRegisterTab);

// ======================================
// UPDATE USER INTERFACE
// ======================================

function updateUserInterface() {
    if (currentUser) {
        loginOpen.classList.add("hidden");
        logoutButton.classList.remove("hidden");
    } else {
        loginOpen.classList.remove("hidden");
        logoutButton.classList.add("hidden");
    }
}

// ======================================
// CHECK LOGIN SESSION
// ======================================

async function checkLogin() {
    try {
        const data = await apiRequest("/api/auth/me");
        currentUser = data.user || data;
    } catch (error) {
        currentUser = null;
    }

    updateUserInterface();
}

// ======================================
// LOGIN
// ======================================

document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    const authMessage = document.getElementById("authMessage");

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
        const data = await apiRequest("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        currentUser = data.user || data;
        updateUserInterface();
        closeAuthModal();

        document.getElementById("loginForm").reset();

        showMessage(formMessage, "Login successful!");
        await loadIdeas();

    } catch (error) {
        showMessage(authMessage, error.message, true);
    }
});

// ======================================
// REGISTER
// ======================================

document.getElementById("registerForm").addEventListener("submit", async event => {
    event.preventDefault();

    const authMessage = document.getElementById("authMessage");

    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const collegeName = document.getElementById("registerCollege").value.trim();
    const department = document.getElementById("registerDepartment").value.trim();
    const password = document.getElementById("registerPassword").value;

    try {
        await apiRequest("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                name,
                email,
                collegeName,
                department,
                password
            })
        });

        showMessage(authMessage, "Registration successful! Please log in.");
        document.getElementById("registerForm").reset();

        showLoginTab();

    } catch (error) {
        showMessage(authMessage, error.message, true);
    }
});

// ======================================
// LOGOUT
// ======================================

logoutButton.addEventListener("click", async () => {
    try {
        await apiRequest("/api/auth/logout", {
            method: "POST"
        });

        currentUser = null;
        updateUserInterface();
        showMessage(formMessage, "You have logged out.");
        await loadIdeas();

    } catch (error) {
        alert(error.message);
    }
});

// ======================================
// LOAD IDEAS
// ======================================

async function loadIdeas() {
    try {
        const data = await apiRequest("/api/posts");

        allPosts = Array.isArray(data)
            ? data
            : (data.posts || []);

        displayIdeas();

    } catch (error) {
        ideasFeed.innerHTML =
            `<p class="loading-message">${escapeHTML(error.message)}</p>`;
    }
}

// ======================================
// DISPLAY IDEAS
// ======================================

function displayIdeas() {
    const searchText = document
        .getElementById("searchIdeas")
        .value.toLowerCase()
        .trim();

    const selectedCategory = document
        .getElementById("categoryFilter")
        .value;

    const filteredPosts = allPosts.filter(post => {
        const matchesSearch =
            String(post.title || "").toLowerCase().includes(searchText) ||
            String(post.category || "").toLowerCase().includes(searchText) ||
            String(post.description || "").toLowerCase().includes(searchText);

        const matchesCategory =
            !selectedCategory || post.category === selectedCategory;

        return matchesSearch && matchesCategory;
    });

    if (filteredPosts.length === 0) {
        ideasFeed.innerHTML =
            `<p class="loading-message">No ideas found. Be the first to share an idea!</p>`;
        return;
    }

    ideasFeed.innerHTML = filteredPosts.map(post => {
        const comments = Array.isArray(post.comments) ? post.comments : [];

        const commentHTML = comments.map(comment => `
            <div class="comment-item">
                <strong>${escapeHTML(comment.author || comment.name || "Student")}:</strong>
                ${escapeHTML(comment.text || comment.comment || "")}
            </div>
        `).join("");

        return `
            <article class="idea-card" data-id="${Number(post.id)}">
                <span class="idea-category">
                    ${escapeHTML(post.category || "General")}
                </span>

                <h3>${escapeHTML(post.title)}</h3>

                <p>${escapeHTML(post.description)}</p>

                <div class="idea-meta">
                    By ${escapeHTML(post.author || "Student")}
                    ${post.department ? " · " + escapeHTML(post.department) : ""}
                </div>

                <div class="idea-actions">
                    <button class="action-button like-button"
                            data-id="${Number(post.id)}">
                        ❤️ Like (${Number(post.likes) || 0})
                    </button>

                    <button class="action-button"
                            type="button"
                            onclick="focusComment(${Number(post.id)})">
                        💬 Comment (${comments.length})
                    </button>
                </div>

                <div class="comments-list">
                    ${commentHTML}
                </div>

                <div class="comment-area">
                    <input type="text"
                           id="comment-${Number(post.id)}"
                           placeholder="Write a comment...">

                    <button type="button"
                            onclick="addComment(${Number(post.id)})">
                        Send
                    </button>
                </div>
            </article>
        `;
    }).join("");

    document.querySelectorAll(".like-button").forEach(button => {
        button.addEventListener("click", () => {
            likeIdea(Number(button.dataset.id));
        });
    });
}

// ======================================
// SEARCH AND CATEGORY FILTER
// ======================================

document.getElementById("searchIdeas").addEventListener("input", displayIdeas);
document.getElementById("categoryFilter").addEventListener("change", displayIdeas);

// ======================================
// SHARE A NEW IDEA
// ======================================

ideaForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!currentUser) {
        openAuthModal();
        showMessage(formMessage, "Please log in before sharing an idea.", true);
        return;
    }

    const title = document.getElementById("title").value.trim();
    const category = document.getElementById("category").value;
    const description = document.getElementById("description").value.trim();

    if (!title || !category || !description) {
        showMessage(formMessage, "Please fill in all fields.", true);
        return;
    }

    try {
        await apiRequest("/api/posts", {
            method: "POST",
            body: JSON.stringify({
                title,
                category,
                description
            })
        });

        ideaForm.reset();
        showMessage(formMessage, "Your idea was shared successfully!");

        await loadIdeas();

        window.location.hash = "#ideas";

    } catch (error) {
        showMessage(formMessage, error.message, true);
    }
});

// ======================================
// LIKE AN IDEA
// ======================================

async function likeIdea(id) {
    if (!currentUser) {
        openAuthModal();
        return;
    }

    try {
        await apiRequest(`/api/posts/${id}/like`, {
            method: "POST"
        });

        // The server broadcasts the updated like count.
        // Reloading also keeps the current browser in sync.
        await loadIdeas();

    } catch (error) {
        alert(error.message);
    }
}

// ======================================
// FOCUS COMMENT INPUT
// ======================================

function focusComment(id) {
    const input = document.getElementById(`comment-${id}`);

    if (input) {
        input.focus();
    }
}

// ======================================
// ADD COMMENT
// ======================================

async function addComment(id) {
    if (!currentUser) {
        openAuthModal();
        return;
    }

    const input = document.getElementById(`comment-${id}`);
    const comment = input.value.trim();

    if (!comment) {
        alert("Please enter a comment.");
        return;
    }

    try {
        await apiRequest(`/api/posts/${id}/comments`, {
            method: "POST",
            body: JSON.stringify({ comment })
        });

        input.value = "";
        await loadIdeas();

    } catch (error) {
        alert(error.message);
    }
}

// ======================================
// REAL-TIME NEW POST
// ======================================

socket.on("newPost", post => {
    const exists = allPosts.some(item => Number(item.id) === Number(post.id));

    if (!exists) {
        allPosts.unshift(post);
        displayIdeas();
    }
});

// ======================================
// REAL-TIME LIKE UPDATE
// ======================================

socket.on("postLiked", update => {
    const post = allPosts.find(item => Number(item.id) === Number(update.id));

    if (post) {
        post.likes = update.likes;
        displayIdeas();
    }
});

// ======================================
// REAL-TIME COMMENT UPDATE
// ======================================

socket.on("newComment", update => {
    const post = allPosts.find(
        item => Number(item.id) === Number(update.postId)
    );

    if (post) {
        if (!Array.isArray(post.comments)) {
            post.comments = [];
        }

        post.comments.push(update.comment);
        displayIdeas();
    }
});

// ======================================
// INITIALIZE APPLICATION
// ======================================

async function initializeApp() {
    await checkLogin();
    await loadIdeas();
}

initializeApp();
