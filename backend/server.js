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

const app = express();
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
// CONNEXION MySQL
// ============================================
const db = mysql.createConnection({
  host: "bcs5gda0htnrrrfyr38k-mysql.services.clever-cloud.com",
  user: "unefpxhycbw35vpw",
  password: "skeSCz7C9RJzGNDZko1k",
  database: "bcs5gda0htnrrrfyr38k",
  port:3306
});
// const db = mysql.createConnection({
//   host: "localhost",
//   user: "root",
//   password: "musk",
//   database: "drive"
// });
db.connect(err => {
  if (err) {
    console.error("❌ Erreur connexion MySQL:", err);
    throw err;
  }
  console.log("✅ Connecté à MySQL (drive)");
});

// Promisify db queries
const promiseDb = db.promise();

// ============================================
// DOSSIER UPLOADS
// ============================================
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ============================================
// CONFIGURATION MULTER
// ============================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = file.originalname.replace(ext, "");
    cb(null, name + "-" + Date.now() + ext);
  }
});
const upload = multer({ storage });

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

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
// SERVEUR FICHIERS STATIQUES
// ============================================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ============================================
// ROUTES D'AUTHENTIFICATION
// ============================================

// 1. INSCRIPTION
app.post("/auth/register", async (req, res) => {
  const { nom_complet, email, password, pays, telephone, division, activite_id } = req.body;
  console.log("Tentative d'inscription avec:", { nom_complet, email, password, pays, telephone, division, activite_id });
  // Validation des champs obligatoires
  if (!nom_complet || !email || !password || !pays || !telephone || !division) {
    return res.status(400).json({ 
      message: "Tous les champs obligatoires doivent être remplis" 
    });
  }

  // Validation du mot de passe
  if (password.length < 6) {
    return res.status(400).json({ 
      message: "Le mot de passe doit contenir au moins 6 caractères" 
    });
  }

  try {
    // Vérifier si l'email existe déjà
    const [existingUser] = await promiseDb.query(
      "SELECT id FROM utilisateurs WHERE email = ?", 
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ message: "Cet email est déjà utilisé" });
    }

    // Vérifier si le téléphone existe déjà
    const [existingPhone] = await promiseDb.query(
      "SELECT id FROM utilisateurs WHERE telephone = ?", 
      [telephone]
    );

    if (existingPhone.length > 0) {
      return res.status(400).json({ message: "Ce numéro de téléphone est déjà utilisé" });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Insérer l'utilisateur
    const [result] = await promiseDb.query(
      `INSERT INTO utilisateurs 
       (nom_complet, email, password, pays, telephone, division, activite_id, accept_conditions) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [nom_complet, email, hashedPassword, pays, telephone, division, activite_id || null]
    );

    // Générer un token JWT
    const token = jwt.sign(
      { 
        id: result.insertId, 
        email, 
        nom_complet,
        division 
      }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Récupérer l'utilisateur sans le mot de passe
    const [newUser] = await promiseDb.query(
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

// 2. CONNEXION
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("Tentative de connexion avec:", { email, password });

  if (!email || !password) {
    return res.status(400).json({ 
      message: "Email et mot de passe requis" 
    });
  }

  try {
    // Récupérer l'utilisateur avec son mot de passe
    const [users] = await promiseDb.query(
      "SELECT * FROM utilisateurs WHERE email = ?", 
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    }

    const user = users[0];

    // Vérifier le mot de passe
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    }

    // Ne pas renvoyer le mot de passe
    delete user.password;

    // Générer un token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        nom_complet: user.nom_complet,
        division: user.division 
      }, 
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

// 3. RAFRAÎCHIR LE TOKEN
app.post("/auth/refresh", authenticateToken, (req, res) => {
  const token = jwt.sign(
    { 
      id: req.user.id, 
      email: req.user.email, 
      nom_complet: req.user.nom_complet,
      division: req.user.division 
    }, 
    JWT_SECRET, 
    { expiresIn: '24h' }
  );

  res.json({ token });
});

// 4. DÉCONNEXION
app.post("/auth/logout", (req, res) => {
  res.json({ message: "Déconnexion réussie" });
});

// 5. PROFIL UTILISATEUR
app.get("/auth/profile", authenticateToken, async (req, res) => {
  try {
    const [users] = await promiseDb.query(
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

// 6. VÉRIFIER LE TOKEN
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
// ROUTES PROTÉGÉES - DOSSIERS
// ============================================

// GET - Récupérer tous les dossiers de l'utilisateur
app.get("/folders", authenticateToken, (req, res) => {
  db.query(
    "SELECT * FROM folders WHERE user_id = ? OR user_id IS NULL", 
    [req.user.id], 
    (err, results) => {
      if (err) {
        console.error("❌ Erreur GET /folders:", err);
        return res.status(500).json({ message: "Erreur serveur lors de la récupération des dossiers" });
      }
      res.json(results);
    }
  );
});

// POST - Créer un nouveau dossier
app.post("/folders", authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "Nom du dossier requis" });
  
  db.query(
    "INSERT INTO folders (name, user_id) VALUES (?, ?)", 
    [name, req.user.id], 
    (err, result) => {
      if (err) {
        console.error("❌ Erreur POST /folders:", err);
        return res.status(500).json({ message: "Erreur lors de la création du dossier" });
      }
      console.log(`✅ Dossier créé: ${name} (ID: ${result.insertId}) pour utilisateur ${req.user.id}`);
      res.json({ id: result.insertId, name, user_id: req.user.id });
    }
  );
});

// PUT - Renommer un dossier
app.put("/folders/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) return res.status(400).json({ message: "Nouveau nom requis" });
  
  db.query(
    "UPDATE folders SET name = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL)", 
    [name, id, req.user.id], 
    (err, result) => {
      if (err) {
        console.error("❌ Erreur PUT /folders:", err);
        return res.status(500).json({ message: "Erreur lors du renommage du dossier" });
      }
      if (result.affectedRows === 0) return res.status(404).json({ message: "Dossier non trouvé ou non autorisé" });
      res.json({ id: parseInt(id), name, message: "Dossier renommé avec succès" });
    }
  );
});

// DELETE - Supprimer un dossier
app.delete("/folders/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  
  console.log(`🗑️ Suppression du dossier ${id} pour utilisateur ${req.user.id}`);
  
  // 1. Récupérer le nom du dossier parent
  db.query(
    "SELECT name FROM folders WHERE id = ? AND (user_id = ? OR user_id IS NULL)", 
    [id, req.user.id], 
    (err, folderResults) => {
      if (err) {
        console.error("❌ Erreur SELECT folder name:", err);
        return res.status(500).json({ message: "Erreur lors de la récupération du dossier" });
      }
      
      if (folderResults.length === 0) {
        return res.status(404).json({ message: "Dossier non trouvé ou non autorisé" });
      }
      
      const folderName = folderResults[0].name;
      
      // 2. Récupérer tous les sous-dossiers à supprimer
      db.query(
        "SELECT id, name FROM folders WHERE (name = ? OR name LIKE ?) AND (user_id = ? OR user_id IS NULL)", 
        [folderName, `${folderName}/%`, req.user.id], 
        (err, allFolders) => {
          if (err) {
            console.error("❌ Erreur SELECT subfolders:", err);
            return res.status(500).json({ message: "Erreur lors de la récupération des sous-dossiers" });
          }
          
          const folderIds = allFolders.map(f => f.id);
          
          if (folderIds.length === 0) {
            return res.status(404).json({ message: "Aucun dossier à supprimer" });
          }
          
          // 3. Récupérer tous les fichiers
          db.query("SELECT url FROM files WHERE folder_id IN (?)", [folderIds], (err, fileResults) => {
            if (err) {
              console.error("❌ Erreur SELECT files:", err);
              return res.status(500).json({ message: "Erreur lors de la récupération des fichiers" });
            }
            
            // 4. Supprimer les fichiers physiquement
            let filesDeleted = 0;
            fileResults.forEach(file => {
              if (file.url) {
                const filename = path.basename(file.url);
                const filePath = path.join(__dirname, "uploads", filename);
                if (fs.existsSync(filePath)) {
                  try {
                    fs.unlinkSync(filePath);
                    filesDeleted++;
                    console.log(`✅ Fichier physique supprimé: ${filename}`);
                  } catch (unlinkErr) {
                    console.error(`❌ Erreur suppression fichier ${filename}:`, unlinkErr);
                  }
                }
              }
            });
            
            // 5. Supprimer les fichiers de la base
            db.query("DELETE FROM files WHERE folder_id IN (?)", [folderIds], (err) => {
              if (err) {
                console.error("❌ Erreur DELETE files:", err);
                return res.status(500).json({ message: "Erreur lors de la suppression des fichiers" });
              }
              
              // 6. Supprimer les dossiers
              db.query("DELETE FROM folders WHERE id IN (?)", [folderIds], (err, result) => {
                if (err) {
                  console.error("❌ Erreur DELETE folders:", err);
                  return res.status(500).json({ message: "Erreur lors de la suppression des dossiers" });
                }
                
                console.log(`✅ ${result.affectedRows} dossier(s) supprimé(s) avec ${filesDeleted} fichier(s)`);
                res.json({ 
                  message: "Dossier et son contenu supprimés avec succès",
                  foldersDeleted: result.affectedRows,
                  filesDeleted
                });
              });
            });
          });
        }
      );
    }
  );
});

// ============================================
// ROUTES PROTÉGÉES - FICHIERS
// ============================================

// GET - Récupérer tous les fichiers de l'utilisateur
app.get("/files", authenticateToken, (req, res) => {
  db.query(
    `SELECT f.* FROM files f 
     JOIN folders fol ON f.folder_id = fol.id 
     WHERE fol.user_id = ? OR fol.user_id IS NULL`,
    [req.user.id], 
    (err, results) => {
      if (err) {
        console.error("❌ Erreur GET /files:", err);
        return res.status(500).json({ message: "Erreur serveur lors de la récupération des fichiers" });
      }
      res.json(results);
    }
  );
});

// POST - Upload fichier
app.post("/upload", authenticateToken, upload.single("file"), async (req, res) => {
  console.log("📥 Requête POST /upload reçue de l'utilisateur:", req.user.id);
  
  const { folder_id } = req.body;
  
  if (!req.file) {
    console.error("❌ Aucun fichier reçu");
    return res.status(400).json({ message: "Fichier manquant" });
  }

  if (!folder_id) {
    console.error("❌ Aucun folder_id reçu");
    return res.status(400).json({ message: "ID du dossier manquant" });
  }

  // Vérifier que le dossier appartient à l'utilisateur
  const [folderCheck] = await promiseDb.query(
    "SELECT id FROM folders WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
    [folder_id, req.user.id]
  );

  if (folderCheck.length === 0) {
    return res.status(403).json({ message: "Dossier non trouvé ou non autorisé" });
  }

  const fileUrl = `http://192.168.151.20:3002/uploads/${req.file.filename}`;
  const fileName = req.file.originalname;
  const fileSize = req.file.size;

  console.log(`📤 Upload fichier: ${fileName} (${fileSize} bytes) dans dossier ${folder_id}`);

  // Enregistrer dans la base
  db.query(
    "INSERT INTO files (name, folder_id, url, size, created_at) VALUES (?, ?, ?, ?, NOW())",
    [fileName, folder_id, fileUrl, fileSize],
    (err, result) => {
      if (err) {
        console.error("❌ Erreur POST /upload:", err);
        return res.status(500).json({ message: "Erreur lors de l'enregistrement du fichier" });
      }
      console.log(`✅ Fichier ${fileName} enregistré avec ID ${result.insertId}`);
      res.json({ 
        id: result.insertId, 
        name: fileName, 
        folder_id: parseInt(folder_id), 
        url: fileUrl, 
        size: fileSize,
        created_at: new Date().toISOString()
      });
    }
  );
});

// DELETE - Supprimer un fichier
app.delete("/files/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  console.log(`🗑️ Suppression du fichier ${id} par utilisateur ${req.user.id}`);

  try {
    // Vérifier que le fichier appartient à l'utilisateur
    const [fileCheck] = await promiseDb.query(
      `SELECT f.* FROM files f 
       JOIN folders fol ON f.folder_id = fol.id 
       WHERE f.id = ? AND (fol.user_id = ? OR fol.user_id IS NULL)`,
      [id, req.user.id]
    );

    if (fileCheck.length === 0) {
      return res.status(404).json({ message: "Fichier non trouvé ou non autorisé" });
    }

    const file = fileCheck[0];

    // Supprimer de la base
    await promiseDb.query("DELETE FROM files WHERE id = ?", [id]);

    // Supprimer le fichier physique
    if (file.url) {
      const filename = path.basename(file.url);
      const filePath = path.join(__dirname, "uploads", filename);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✅ Fichier physique supprimé: ${filename}`);
      }
    }

    console.log(`✅ Fichier supprimé: ${file.name} (ID: ${id})`);
    
    res.json({ 
      message: "Fichier supprimé avec succès",
      fileName: file.name
    });

  } catch (err) {
    console.error("❌ Erreur lors de la suppression:", err);
    res.status(500).json({ 
      message: "Erreur lors de la suppression du fichier"
    });
  }
});

// PUT - Renommer un fichier
app.put("/files/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) return res.status(400).json({ message: "Nouveau nom requis" });
  
  try {
    // Vérifier que le fichier appartient à l'utilisateur
    const [fileCheck] = await promiseDb.query(
      `SELECT f.* FROM files f 
       JOIN folders fol ON f.folder_id = fol.id 
       WHERE f.id = ? AND (fol.user_id = ? OR fol.user_id IS NULL)`,
      [id, req.user.id]
    );

    if (fileCheck.length === 0) {
      return res.status(404).json({ message: "Fichier non trouvé ou non autorisé" });
    }

    await promiseDb.query(
      "UPDATE files SET name = ? WHERE id = ?", 
      [name, id]
    );

    res.json({ id: parseInt(id), name, message: "Fichier renommé avec succès" });

  } catch (err) {
    console.error("❌ Erreur PUT /files:", err);
    res.status(500).json({ message: "Erreur lors du renommage du fichier" });
  }
});

// GET - Fichiers par dossier avec pagination
app.get("/files/folder/:folderId", authenticateToken, async (req, res) => {
  const { folderId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  
  try {
    // Vérifier que le dossier appartient à l'utilisateur
    const [folderCheck] = await promiseDb.query(
      "SELECT id FROM folders WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
      [folderId, req.user.id]
    );

    if (folderCheck.length === 0) {
      return res.status(404).json({ message: "Dossier non trouvé ou non autorisé" });
    }

    const [files] = await promiseDb.query(
      "SELECT SQL_CALC_FOUND_ROWS * FROM files WHERE folder_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [folderId, limit, offset]
    );

    const [countResult] = await promiseDb.query("SELECT FOUND_ROWS() as total");
    
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


// drive-backend/server.js - Ajouter après les routes d'authentification

// POST - Soumettre formulaire statistiques
// drive-backend/server.js - Modifier la route POST /statistics/submit

app.post("/statistics/submit", authenticateToken, async (req, res) => {
  try {
    const formData = req.body;
    const userId = req.user.id;

    console.log(`📊 Formulaire reçu de l'utilisateur ${userId} pour le dossier ${formData.folderId || 'non spécifié'}`);

    // Validation des données requises
    const requiredFields = [
      'region', 'structure', 'nomPrenoms', 'telephone', 'fonction',
      'documentValide', 'libelleActivite', 'typeActivite',
      'objectifActivite', 'lieuActivite', 'suiviPost'
    ];

    for (const field of requiredFields) {
      if (!formData[field]) {
        return res.status(400).json({ 
          message: `Le champ ${field} est requis` 
        });
      }
    }

    // Vérifier que le dossier appartient à l'utilisateur (si folderId est fourni)
    if (formData.folderId) {
      const [folderCheck] = await promiseDb.query(
        "SELECT id FROM folders WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
        [formData.folderId, userId]
      );

      if (folderCheck.length === 0) {
        return res.status(403).json({ message: "Dossier non trouvé ou non autorisé" });
      }
    }

    // Insertion dans la base de données
    const [result] = await promiseDb.query(
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

    console.log(`✅ Formulaire enregistré avec ID: ${result.insertId}`);

    res.json({ 
      message: "Formulaire soumis avec succès",
      submissionId: result.insertId,
      data: formData 
    });

  } catch (err) {
    console.error("❌ Erreur soumission formulaire:", err);
    res.status(500).json({ 
      message: "Erreur lors de la soumission du formulaire",
      error: err.message 
    });
  }
});

// Dans server.js, remplacer la route GET /statistics/submissions par :


// GET - Récupérer TOUTES les soumissions (pour tout le monde)
// GET - Récupérer TOUTES les soumissions (pour tout le monde)
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

        // Tri valide
        const validSortFields = ['created_at', 'region', 'structure', 'type_activite', 'date_activite'];
        const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
        const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
        
        query += ` ORDER BY s.${sortField} ${order} LIMIT ? OFFSET ?`;
        queryParams.push(limit, offset);

        const [submissions] = await promiseDb.query(query, queryParams);
        const [countResult] = await promiseDb.query("SELECT FOUND_ROWS() as total");

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

// GET - Récupérer la liste des utilisateurs pour le filtre
app.get("/statistics/users", authenticateToken, async (req, res) => {
    try {
        const [users] = await promiseDb.query(
            "SELECT id, nom_complet FROM utilisateurs ORDER BY nom_complet"
        );
        res.json(users);
    } catch (err) {
        console.error("❌ Erreur récupération utilisateurs:", err);
        res.status(500).json({ message: "Erreur lors de la récupération des utilisateurs" });
    }
});


// GET - Récupérer la liste des utilisateurs pour le filtre
app.get("/statistics/users", authenticateToken, async (req, res) => {
    try {
        const [users] = await promiseDb.query(
            "SELECT id, nom_complet FROM utilisateurs ORDER BY nom_complet"
        );
        res.json(users);
    } catch (err) {
        console.error("❌ Erreur récupération utilisateurs:", err);
        res.status(500).json({ message: "Erreur lors de la récupération des utilisateurs" });
    }
});

// GET - Récupérer les soumissions de l'utilisateur avec filtres et tri
app.get("/statistics/submissions",authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const sortBy = req.query.sortBy || 'created_at';
        const sortOrder = req.query.sortOrder || 'desc';
        
        // Récupérer les filtres
        const { region, structure, typeActivite, dateDebut, dateFin } = req.query;

        // Construire la requête SQL avec filtres
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

        // Ajouter le tri
        const validSortFields = ['created_at', 'region', 'structure', 'type_activite', 'date_activite', 'lieu_activite'];
        const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
        const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
        
        query += ` ORDER BY ${sortField} ${order} LIMIT ? OFFSET ?`;
        queryParams.push(limit, offset);

        const [submissions] = await promiseDb.query(query, queryParams);
        const [countResult] = await promiseDb.query("SELECT FOUND_ROWS() as total");

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

    const [submissions] = await promiseDb.query(
      `SELECT * FROM statistics_submissions 
       WHERE id = ? AND user_id = ?`,
      [submissionId, userId]
    );

    if (submissions.length === 0) {
      return res.status(404).json({ message: "Soumission non trouvée" });
    }

    const submission = submissions[0];
    
    // Parser les champs JSON
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

    const [result] = await promiseDb.query(
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
// DÉMARRAGE SERVEUR
// ============================================
const PORT = 3002;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`🚀 Serveur démarré sur http://${HOST}:${PORT}`);
  console.log(`📡 API accessible sur http://192.168.210.20:${PORT}`);
});