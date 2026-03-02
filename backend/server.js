// drive-backend/server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cloudinary = require('./cloudinary');

const app = express();

// Configuration CORS
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ============================================
// CONFIGURATION
// ============================================
const JWT_SECRET = 'votre_clé_secrète_très_longue_et_aléatoire_123456789';
const SALT_ROUNDS = 10;

// ============================================
// CONNEXION MySQL avec POOL
// ============================================
const pool = mysql.createPool({
  host: "bcs5gda0htnrrrfyr38k-mysql.services.clever-cloud.com",
  user: "unefpxhycbw35vpw",
  password: "skeSCz7C9RJzGNDZko1k",
  database: "bcs5gda0htnrrrfyr38k",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 60000
});

const promisePool = pool.promise();

// Tester la connexion au démarrage
pool.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Erreur initiale connexion MySQL:", err);
  } else {
    console.log("✅ Pool MySQL prêt - Connecté à la base de données");
    connection.release();
  }
});

// ============================================
// DOSSIER TEMPORAIRE POUR UPLOADS
// ============================================
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// ============================================
// CONFIGURATION MULTER
// ============================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "temp/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = file.originalname.replace(ext, "").replace(/[^a-zA-Z0-9]/g, '-');
    cb(null, name + "-" + Date.now() + ext);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: "Token manquant" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Token invalide ou expiré" });
    }
    req.user = user;
    next();
  });
};

// ============================================
// ROUTES DE TEST
// ============================================
app.get("/", (req, res) => {
  res.json({ 
    message: "API Drive Opened - Backend is running",
    status: "OK",
    time: new Date().toISOString()
  });
});

app.get("/health", async (req, res) => {
  try {
    await promisePool.query('SELECT 1');
    await cloudinary.api.ping();
    res.json({ 
      status: "OK", 
      database: "connected",
      cloudinary: "connected",
      time: new Date().toISOString()
    });
  } catch (err) {
    res.json({ 
      status: "Degraded", 
      database: err.message.includes('SELECT') ? "disconnected" : "connected",
      cloudinary: err.message.includes('cloudinary') ? "disconnected" : "connected",
      error: err.message,
      time: new Date().toISOString()
    });
  }
});

// ============================================
// ROUTES D'AUTHENTIFICATION
// ============================================

// INSCRIPTION
app.post("/auth/register", async (req, res) => {
  const { nom_complet, email, password, pays, telephone, division, activite_id } = req.body;
  
  if (!nom_complet || !email || !password || !pays || !telephone || !division) {
    return res.status(400).json({ message: "Tous les champs obligatoires doivent être remplis" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Le mot de passe doit contenir au moins 6 caractères" });
  }

  try {
    const [existingUser] = await promisePool.query("SELECT id FROM utilisateurs WHERE email = ?", [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ message: "Cet email est déjà utilisé" });
    }

    const [existingPhone] = await promisePool.query("SELECT id FROM utilisateurs WHERE telephone = ?", [telephone]);
    if (existingPhone.length > 0) {
      return res.status(400).json({ message: "Ce numéro de téléphone est déjà utilisé" });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const [result] = await promisePool.query(
      `INSERT INTO utilisateurs (nom_complet, email, password, pays, telephone, division, activite_id, accept_conditions) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [nom_complet, email, hashedPassword, pays, telephone, division, activite_id || null]
    );

    const token = jwt.sign(
      { id: result.insertId, email, nom_complet, division }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    const [newUser] = await promisePool.query(
      "SELECT id, nom_complet, email, pays, telephone, division, activite_id, created_at FROM utilisateurs WHERE id = ?",
      [result.insertId]
    );

    res.status(201).json({
      message: "Inscription réussie",
      token,
      user: newUser[0]
    });

  } catch (err) {
    console.error("❌ Erreur inscription:", err);
    res.status(500).json({ message: "Erreur lors de l'inscription" });
  }
});

// CONNEXION
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email et mot de passe requis" });
  }

  try {
    const [users] = await promisePool.query("SELECT * FROM utilisateurs WHERE email = ?", [email]);

    if (users.length === 0) {
      return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    }

    delete user.password;

    const token = jwt.sign(
      { id: user.id, email: user.email, nom_complet: user.nom_complet, division: user.division }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({
      message: "Connexion réussie",
      token,
      user
    });

  } catch (err) {
    console.error("❌ Erreur connexion:", err);
    res.status(500).json({ message: "Erreur lors de la connexion" });
  }
});

// RAFRAÎCHIR LE TOKEN
app.post("/auth/refresh", authenticateToken, (req, res) => {
  const token = jwt.sign(
    { id: req.user.id, email: req.user.email, nom_complet: req.user.nom_complet, division: req.user.division }, 
    JWT_SECRET, 
    { expiresIn: '24h' }
  );
  res.json({ token });
});

// DÉCONNEXION
app.post("/auth/logout", (req, res) => {
  res.json({ message: "Déconnexion réussie" });
});

// PROFIL UTILISATEUR
app.get("/auth/profile", authenticateToken, async (req, res) => {
  try {
    const [users] = await promisePool.query(
      "SELECT id, nom_complet, email, pays, telephone, division, activite_id, created_at FROM utilisateurs WHERE id = ?",
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    res.json(users[0]);
  } catch (err) {
    console.error("❌ Erreur profil:", err);
    res.status(500).json({ message: "Erreur lors de la récupération du profil" });
  }
});

// VÉRIFIER LE TOKEN
app.get("/auth/verify", authenticateToken, (req, res) => {
  res.json({ 
    valid: true, 
    user: {
      id: req.user.id,
      email: req.user.email,
      nom_complet: req.user.nom_complet,
      division: req.user.division
    }
  });
});

// ============================================
// ROUTES DOSSIERS
// ============================================

// GET - Récupérer tous les dossiers
app.get("/folders", authenticateToken, async (req, res) => {
  try {
    const [results] = await promisePool.query(
      "SELECT * FROM folders WHERE user_id = ? OR user_id IS NULL", 
      [req.user.id]
    );
    res.json(results);
  } catch (err) {
    console.error("❌ Erreur GET /folders:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST - Créer un nouveau dossier
app.post("/folders", authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "Nom du dossier requis" });
  
  try {
    const [result] = await promisePool.query(
      "INSERT INTO folders (name, user_id) VALUES (?, ?)", 
      [name, req.user.id]
    );
    res.json({ id: result.insertId, name, user_id: req.user.id });
  } catch (err) {
    console.error("❌ Erreur POST /folders:", err);
    res.status(500).json({ message: "Erreur lors de la création du dossier" });
  }
});

// PUT - Renommer un dossier
app.put("/folders/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) return res.status(400).json({ message: "Nouveau nom requis" });
  
  try {
    const [result] = await promisePool.query(
      "UPDATE folders SET name = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL)", 
      [name, id, req.user.id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Dossier non trouvé ou non autorisé" });
    }
    
    res.json({ id: parseInt(id), name, message: "Dossier renommé avec succès" });
  } catch (err) {
    console.error("❌ Erreur PUT /folders:", err);
    res.status(500).json({ message: "Erreur lors du renommage" });
  }
});

// DELETE - Supprimer un dossier (avec Cloudinary)
app.delete("/folders/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const [folderResults] = await promisePool.query(
      "SELECT name FROM folders WHERE id = ? AND (user_id = ? OR user_id IS NULL)", 
      [id, req.user.id]
    );
    
    if (folderResults.length === 0) {
      return res.status(404).json({ message: "Dossier non trouvé ou non autorisé" });
    }
    
    const folderName = folderResults[0].name;
    
    const [allFolders] = await promisePool.query(
      "SELECT id FROM folders WHERE (name = ? OR name LIKE ?) AND (user_id = ? OR user_id IS NULL)", 
      [folderName, `${folderName}/%`, req.user.id]
    );
    
    const folderIds = allFolders.map(f => f.id);
    
    if (folderIds.length === 0) {
      return res.status(404).json({ message: "Aucun dossier à supprimer" });
    }
    
    const [fileResults] = await promisePool.query(
      "SELECT cloudinary_id FROM files WHERE folder_id IN (?)", 
      [folderIds]
    );
    
    let cloudinaryDeleted = 0;
    for (const file of fileResults) {
      if (file.cloudinary_id) {
        try {
          await cloudinary.uploader.destroy(file.cloudinary_id);
          cloudinaryDeleted++;
        } catch (cloudinaryErr) {
          console.error(`❌ Erreur suppression Cloudinary:`, cloudinaryErr);
        }
      }
    }
    
    await promisePool.query("DELETE FROM files WHERE folder_id IN (?)", [folderIds]);
    const [result] = await promisePool.query("DELETE FROM folders WHERE id IN (?)", [folderIds]);
    
    res.json({ 
      message: "Dossier et son contenu supprimés avec succès",
      foldersDeleted: result.affectedRows,
      cloudinaryDeleted
    });

  } catch (err) {
    console.error("❌ Erreur DELETE /folders:", err);
    res.status(500).json({ message: "Erreur lors de la suppression" });
  }
});

// ============================================
// ROUTES FICHIERS (avec Cloudinary)
// ============================================

// GET - Récupérer tous les fichiers
app.get("/files", authenticateToken, async (req, res) => {
  try {
    const [results] = await promisePool.query(
      `SELECT f.* FROM files f 
       JOIN folders fol ON f.folder_id = fol.id 
       WHERE fol.user_id = ? OR fol.user_id IS NULL`,
      [req.user.id]
    );
    res.json(results);
  } catch (err) {
    console.error("❌ Erreur GET /files:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST - Upload fichier vers Cloudinary
app.post("/upload", authenticateToken, upload.single("file"), async (req, res) => {
  const { folder_id } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ message: "Fichier manquant" });
  }

  if (!folder_id) {
    if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    return res.status(400).json({ message: "ID du dossier manquant" });
  }

  try {
    const [folderCheck] = await promisePool.query(
      "SELECT id FROM folders WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
      [folder_id, req.user.id]
    );

    if (folderCheck.length === 0) {
      if (req.file && req.file.path) fs.unlinkSync(req.file.path);
      return res.status(403).json({ message: "Dossier non trouvé ou non autorisé" });
    }

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "drive-files",
      resource_type: "auto",
      public_id: `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, '-')}`,
      tags: [`user-${req.user.id}`, `folder-${folder_id}`]
    });

    if (req.file && req.file.path) fs.unlinkSync(req.file.path);

    const [dbResult] = await promisePool.query(
      "INSERT INTO files (name, folder_id, url, cloudinary_url, cloudinary_id, size, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
      [req.file.originalname, folder_id, result.secure_url, result.secure_url, result.public_id, req.file.size]
    );

    res.json({ 
      id: dbResult.insertId, 
      name: req.file.originalname, 
      folder_id: parseInt(folder_id), 
      url: result.secure_url,
      cloudinary_id: result.public_id,
      size: req.file.size,
      created_at: new Date().toISOString()
    });

  } catch (err) {
    console.error("❌ Erreur POST /upload:", err);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ message: "Erreur lors de l'enregistrement du fichier" });
  }
});

// DELETE - Supprimer un fichier
app.delete("/files/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [fileCheck] = await promisePool.query(
      `SELECT f.* FROM files f 
       JOIN folders fol ON f.folder_id = fol.id 
       WHERE f.id = ? AND (fol.user_id = ? OR fol.user_id IS NULL)`,
      [id, req.user.id]
    );

    if (fileCheck.length === 0) {
      return res.status(404).json({ message: "Fichier non trouvé ou non autorisé" });
    }

    const file = fileCheck[0];

    if (file.cloudinary_id) {
      try {
        await cloudinary.uploader.destroy(file.cloudinary_id);
      } catch (cloudinaryErr) {
        console.error("❌ Erreur suppression Cloudinary:", cloudinaryErr);
      }
    }

    await promisePool.query("DELETE FROM files WHERE id = ?", [id]);

    res.json({ message: "Fichier supprimé avec succès" });

  } catch (err) {
    console.error("❌ Erreur lors de la suppression:", err);
    res.status(500).json({ message: "Erreur lors de la suppression du fichier" });
  }
});

// PUT - Renommer un fichier
app.put("/files/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) return res.status(400).json({ message: "Nouveau nom requis" });
  
  try {
    const [fileCheck] = await promisePool.query(
      `SELECT f.* FROM files f 
       JOIN folders fol ON f.folder_id = fol.id 
       WHERE f.id = ? AND (fol.user_id = ? OR fol.user_id IS NULL)`,
      [id, req.user.id]
    );

    if (fileCheck.length === 0) {
      return res.status(404).json({ message: "Fichier non trouvé ou non autorisé" });
    }

    await promisePool.query("UPDATE files SET name = ? WHERE id = ?", [name, id]);

    res.json({ id: parseInt(id), name, message: "Fichier renommé avec succès" });

  } catch (err) {
    console.error("❌ Erreur PUT /files:", err);
    res.status(500).json({ message: "Erreur lors du renommage" });
  }
});

// GET - Fichiers par dossier avec pagination
app.get("/files/folder/:folderId", authenticateToken, async (req, res) => {
  const { folderId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  
  try {
    const [folderCheck] = await promisePool.query(
      "SELECT id FROM folders WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
      [folderId, req.user.id]
    );

    if (folderCheck.length === 0) {
      return res.status(404).json({ message: "Dossier non trouvé ou non autorisé" });
    }

    const [files] = await promisePool.query(
      "SELECT SQL_CALC_FOUND_ROWS * FROM files WHERE folder_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [folderId, limit, offset]
    );

    const [countResult] = await promisePool.query("SELECT FOUND_ROWS() as total");
    
    res.json({
      files,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });

  } catch (err) {
    console.error("❌ Erreur GET /files/folder/:folderId:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// ============================================
// ROUTES STATISTIQUES
// ============================================

// POST - Soumettre formulaire statistiques
app.post("/statistics/submit", authenticateToken, async (req, res) => {
  try {
    const formData = req.body;
    const userId = req.user.id;

    const requiredFields = [
      'region', 'structure', 'nomPrenoms', 'telephone', 'fonction',
      'documentValide', 'libelleActivite', 'typeActivite',
      'objectifActivite', 'lieuActivite', 'suiviPost'
    ];

    for (const field of requiredFields) {
      if (!formData[field]) {
        return res.status(400).json({ message: `Le champ ${field} est requis` });
      }
    }

    if (formData.folderId) {
      const [folderCheck] = await promisePool.query(
        "SELECT id FROM folders WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
        [formData.folderId, userId]
      );

      if (folderCheck.length === 0) {
        return res.status(403).json({ message: "Dossier non trouvé ou non autorisé" });
      }
    }

    const [result] = await promisePool.query(
      `INSERT INTO statistics_submissions (
        user_id, folder_id, folder_path, region, structure, autre_structure, 
        nom_prenoms, telephone, fonction, document_valide, libelle_activite, 
        type_activite, autre_type, date_activite, objectif_activite, lieu_activite,
        suivi_post, statistiques_data, fichiers_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        userId,
        formData.folderId || null,
        formData.folderPath || null,
        formData.region,
        formData.structure,
        formData.autreStructure || null,
        formData.nomPrenoms,
        formData.telephone,
        formData.fonction,
        formData.documentValide,
        formData.libelleActivite,
        formData.typeActivite,
        formData.autreType || null,
        formData.dateActivite,
        formData.objectifActivite,
        formData.lieuActivite,
        formData.suiviPost,
        JSON.stringify(formData.statistiques || {}),
        JSON.stringify(formData.fichiers || [])
      ]
    );

    res.json({ 
      message: "Formulaire soumis avec succès",
      submissionId: result.insertId
    });

  } catch (err) {
    console.error("❌ Erreur soumission formulaire:", err);
    res.status(500).json({ message: "Erreur lors de la soumission" });
  }
});

// GET - Récupérer TOUTES les soumissions
app.get("/statistics/submissions/all", authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'desc';
    
    const { region, structure, type_activite, user_id } = req.query;

    let query = `
      SELECT SQL_CALC_FOUND_ROWS 
        s.*, 
        u.nom_complet as nom_prenoms 
      FROM statistics_submissions s 
      LEFT JOIN utilisateurs u ON s.user_id = u.id 
      WHERE 1=1
    `;
    const queryParams = [];

    if (region) {
      query += ' AND s.region = ?';
      queryParams.push(region);
    }

    if (structure) {
      query += ' AND s.structure = ?';
      queryParams.push(structure);
    }

    if (type_activite) {
      query += ' AND s.type_activite = ?';
      queryParams.push(type_activite);
    }

    if (user_id) {
      query += ' AND s.user_id = ?';
      queryParams.push(user_id);
    }

    const validSortFields = ['created_at', 'region', 'structure', 'type_activite', 'date_activite'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
    
    query += ` ORDER BY s.${sortField} ${order} LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);

    const [submissions] = await promisePool.query(query, queryParams);
    const [countResult] = await promisePool.query("SELECT FOUND_ROWS() as total");

    res.json({
      submissions,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });

  } catch (err) {
    console.error("❌ Erreur récupération soumissions:", err);
    res.status(500).json({ message: "Erreur lors de la récupération des soumissions" });
  }
});

// GET - Récupérer la liste des utilisateurs
app.get("/statistics/users", authenticateToken, async (req, res) => {
  try {
    const [users] = await promisePool.query(
      "SELECT id, nom_complet FROM utilisateurs ORDER BY nom_complet"
    );
    res.json(users);
  } catch (err) {
    console.error("❌ Erreur récupération utilisateurs:", err);
    res.status(500).json({ message: "Erreur lors de la récupération des utilisateurs" });
  }
});

// GET - Récupérer les soumissions de l'utilisateur
app.get("/statistics/submissions", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder || 'desc';
    
    const { region, structure, typeActivite, dateDebut, dateFin } = req.query;

    let query = 'SELECT SQL_CALC_FOUND_ROWS * FROM statistics_submissions WHERE user_id = ?';
    const queryParams = [userId];

    if (region) {
      query += ' AND region = ?';
      queryParams.push(region);
    }

    if (structure) {
      query += ' AND structure = ?';
      queryParams.push(structure);
    }

    if (typeActivite) {
      query += ' AND type_activite = ?';
      queryParams.push(typeActivite);
    }

    if (dateDebut) {
      query += ' AND date_activite >= ?';
      queryParams.push(dateDebut);
    }

    if (dateFin) {
      query += ' AND date_activite <= ?';
      queryParams.push(dateFin);
    }

    const validSortFields = ['created_at', 'region', 'structure', 'type_activite', 'date_activite', 'lieu_activite'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
    
    query += ` ORDER BY ${sortField} ${order} LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);

    const [submissions] = await promisePool.query(query, queryParams);
    const [countResult] = await promisePool.query("SELECT FOUND_ROWS() as total");

    res.json({
      submissions,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });

  } catch (err) {
    console.error("❌ Erreur récupération soumissions:", err);
    res.status(500).json({ message: "Erreur lors de la récupération des soumissions" });
  }
});

// GET - Récupérer une soumission spécifique
app.get("/statistics/submissions/:id", authenticateToken, async (req, res) => {
  try {
    const submissionId = req.params.id;
    const userId = req.user.id;

    const [submissions] = await promisePool.query(
      `SELECT * FROM statistics_submissions WHERE id = ? AND user_id = ?`,
      [submissionId, userId]
    );

    if (submissions.length === 0) {
      return res.status(404).json({ message: "Soumission non trouvée" });
    }

    const submission = submissions[0];
    
    if (submission.statistiques_data) {
      submission.statistiques = JSON.parse(submission.statistiques_data);
    }
    if (submission.fichiers_data) {
      submission.fichiers = JSON.parse(submission.fichiers_data);
    }

    res.json(submission);

  } catch (err) {
    console.error("❌ Erreur récupération soumission:", err);
    res.status(500).json({ message: "Erreur lors de la récupération de la soumission" });
  }
});

// DELETE - Supprimer une soumission
app.delete("/statistics/submissions/:id", authenticateToken, async (req, res) => {
  try {
    const submissionId = req.params.id;
    const userId = req.user.id;

    const [result] = await promisePool.query(
      "DELETE FROM statistics_submissions WHERE id = ? AND user_id = ?",
      [submissionId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Soumission non trouvée" });
    }

    res.json({ message: "Soumission supprimée avec succès" });

  } catch (err) {
    console.error("❌ Erreur suppression soumission:", err);
    res.status(500).json({ message: "Erreur lors de la suppression" });
  }
});

// ============================================
// MIGRATION DE LA TABLE FILES
// ============================================
app.get("/migrate/files-table", async (req, res) => {
  try {
    await promisePool.query(`
      ALTER TABLE files 
      ADD COLUMN IF NOT EXISTS cloudinary_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS cloudinary_id VARCHAR(200)
    `);
    res.json({ message: "Table files mise à jour avec succès" });
  } catch (err) {
    console.error("❌ Erreur migration:", err);
    res.status(500).json({ message: "Erreur lors de la migration" });
  }
});

// ============================================
// POUR VERCEL
// ============================================
module.exports = app;