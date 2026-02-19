// drive-backend/server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors({
  origin: '*', //['http://localhost:5000', 'http://localhost:8081', 'exp://192.168.*.*:8081'],
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


// Connexion MySQL
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "musk",
  database: "drive"
});

db.connect(err => {
  if (err) {
    console.error("❌ Erreur connexion MySQL:", err);
    throw err;
  }
  console.log("✅ Connecté à MySQL (drive)");
});

// Créer le dossier uploads s'il n'existe pas
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuration Multer pour l'upload
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

// Servir les fichiers statiques
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 📂 CRUD FOLDERS

// GET - Récupérer tous les dossiers
app.get("/folders", (req, res) => {
  db.query("SELECT * FROM folders", (err, results) => {
    if (err) {
      console.error("❌ Erreur GET /folders:", err);
      return res.status(500).json({ message: "Erreur serveur lors de la récupération des dossiers" });
    }
    res.json(results);
  });
});


// POST - Créer un nouveau dossier
app.post("/folders", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "Nom du dossier requis" });
  
  db.query("INSERT INTO folders (name) VALUES (?)", [name], (err, result) => {
    if (err) {
      console.error("❌ Erreur POST /folders:", err);
      return res.status(500).json({ message: "Erreur lors de la création du dossier" });
    }else{
      console.log(`✅ Dossier créé: ${name} (ID: ${result.insertId})`);
    }
    res.json({ id: result.insertId, name });
  });
});

// PUT - Renommer un dossier
app.put("/folders/:id", (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) return res.status(400).json({ message: "Nouveau nom requis" });
  
  db.query("UPDATE folders SET name = ? WHERE id = ?", [name, id], (err, result) => {
    if (err) {
      console.error("❌ Erreur PUT /folders:", err);
      return res.status(500).json({ message: "Erreur lors du renommage du dossier" });
    }
    if (result.affectedRows === 0) return res.status(404).json({ message: "Dossier non trouvé" });
    res.json({ id: parseInt(id), name, message: "Dossier renommé avec succès" });
  });
});

// 📄 CRUD FILES

// GET - Récupérer tous les fichiers
app.get("/files", (req, res) => {
  db.query("SELECT * FROM files", (err, results) => {
    if (err) {
      console.error("❌ Erreur GET /files:", err);
      return res.status(500).json({ message: "Erreur serveur lors de la récupération des fichiers" });
    }
    res.json(results);
  });
});

// POST - Upload fichier
// POST - Upload fichier - AMÉLIORÉ
app.post("/upload", upload.single("file"), async (req, res) => {
  console.log("📥 Requête POST /upload reçue");
  console.log("Body:", req.body);
  console.log("File:", req.file);
  
  const { folder_id } = req.body;
  
  if (!req.file) {
    console.error("❌ Aucun fichier reçu");
    return res.status(400).json({ message: "Fichier manquant" });
  }

  if (!folder_id) {
    console.error("❌ Aucun folder_id reçu");
    return res.status(400).json({ message: "ID du dossier manquant" });
  }

  const fileUrl = `http://192.168.45.20:3002/uploads/${req.file.filename}`;
  const fileName = req.file.originalname;
  const fileSize = req.file.size;

  console.log(`📤 Upload fichier: ${fileName} (${fileSize} bytes) dans dossier ${folder_id}`);

  // Vérifier si le dossier existe
  db.query("SELECT id FROM folders WHERE id = ?", [folder_id], (err, results) => {
    if (err) {
      console.error("❌ Erreur vérification dossier:", err);
      return res.status(500).json({ message: "Erreur lors de la vérification du dossier" });
    }
    
    if (results.length === 0) {
      console.error(`❌ Dossier ${folder_id} non trouvé`);
      return res.status(404).json({ message: "Dossier non trouvé" });
    }

    // Enregistrer dans la base
    db.query(
      "INSERT INTO files (name, folder_id, url, size, created_at) VALUES (?, ?, ?, ?, NOW())",
      [fileName, folder_id, fileUrl, fileSize],
      (err, result) => {
        if (err) {
          console.error("❌ Erreur POST /upload:", err);
          return res.status(500).json({ message: "Erreur lors de l'enregistrement du fichier en base" });
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
});

// DELETE - Supprimer un dossier et ses fichiers - AMÉLIORÉ
app.delete("/folders/:id", (req, res) => {
  const { id } = req.params;
  
  console.log(`🗑️ Suppression du dossier ${id} et de ses sous-dossiers`);
  
  // 1. Récupérer le nom du dossier parent
  db.query("SELECT name FROM folders WHERE id = ?", [id], (err, folderResults) => {
    if (err) {
      console.error("❌ Erreur SELECT folder name:", err);
      return res.status(500).json({ message: "Erreur lors de la récupération du dossier" });
    }
    
    if (folderResults.length === 0) {
      return res.status(404).json({ message: "Dossier non trouvé" });
    }
    
    const folderName = folderResults[0].name;
    
    // 2. Récupérer tous les sous-dossiers à supprimer
    db.query("SELECT id, name FROM folders WHERE name = ? OR name LIKE ?", 
      [folderName, `${folderName}/%`], 
      (err, allFolders) => {
        if (err) {
          console.error("❌ Erreur SELECT subfolders:", err);
          return res.status(500).json({ message: "Erreur lors de la récupération des sous-dossiers" });
        }
        
        const folderIds = allFolders.map(f => f.id);
        console.log(`Dossiers à supprimer: ${allFolders.length} (IDs: ${folderIds.join(', ')})`);
        
        if (folderIds.length === 0) {
          return res.status(404).json({ message: "Aucun dossier à supprimer" });
        }
        
        // 3. Récupérer tous les fichiers de tous ces dossiers
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
              return res.status(500).json({ message: "Erreur lors de la suppression des fichiers de la base" });
            }
            
            // 6. Supprimer les dossiers de la base
            db.query("DELETE FROM folders WHERE id IN (?)", [folderIds], (err, result) => {
              if (err) {
                console.error("❌ Erreur DELETE folders:", err);
                return res.status(500).json({ message: "Erreur lors de la suppression des dossiers" });
              }
              
              console.log(`✅ ${result.affectedRows} dossier(s) supprimé(s) avec ${filesDeleted} fichier(s)`);
              res.json({ 
                message: "Dossier et son contenu supprimés avec succès",
                foldersDeleted: result.affectedRows,
                filesDeleted: filesDeleted
              });
            });
          });
        });
      }
    );
  });
});

//DELETE - Supprimer un fichier - AMÉLIORÉ
app.delete("/files/:id", (req, res) => {
  const { id } = req.params;
  
  console.log(`🗑️ Suppression du fichier ${id}`);

  // Démarrer une transaction
  db.beginTransaction(async (err) => {
    if (err) {
      console.error("❌ Erreur début transaction:", err);
      return res.status(500).json({ message: "Erreur lors du début de la transaction" });
    }

    try {
      // 1. Récupérer le fichier AVANT de le supprimer
      const [fileResults] = await db.promise().query(
        "SELECT * FROM files WHERE id = ? FOR UPDATE", 
        [id]
      );
      
      if (fileResults.length === 0) {
        await db.promise().rollback();
        return res.status(404).json({ message: "Fichier non trouvé" });
      }

      const file = fileResults[0];

      // 2. Supprimer de la base
      const [deleteResult] = await db.promise().query(
        "DELETE FROM files WHERE id = ?", 
        [id]
      );

      // 3. Commit la transaction
      await db.promise().commit();

      // 4. Supprimer le fichier physique (après le commit)
      let fileDeleted = false;
      if (file.url) {
        try {
          const filename = path.basename(file.url);
          const filePath = path.join(__dirname, "uploads", filename);
          
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            fileDeleted = true;
            console.log(`✅ Fichier physique supprimé: ${filename}`);
          }
        } catch (unlinkErr) {
          console.error(`⚠️ Erreur suppression fichier physique:`, unlinkErr);
          // On ne fait pas échouer la requête pour ça
        }
      }

      console.log(`✅ Fichier supprimé: ${file.name} (ID: ${id})`);
      
      res.json({ 
        message: "Fichier supprimé avec succès",
        fileDeleted,
        fileName: file.name
      });

    } catch (err) {
      // Rollback en cas d'erreur
      await db.promise().rollback();
      console.error("❌ Erreur lors de la suppression:", err);
      res.status(500).json({ 
        message: "Erreur lors de la suppression du fichier",
        error: err.message 
      });
    }
  });
});




// PUT - Renommer un fichier
app.put("/files/:id", (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) return res.status(400).json({ message: "Nouveau nom requis" });
  
  db.query("UPDATE files SET name = ? WHERE id = ?", [name, id], (err, result) => {
    if (err) {
      console.error("❌ Erreur PUT /files:", err);
      return res.status(500).json({ message: "Erreur lors du renommage du fichier" });
    }
    if (result.affectedRows === 0) return res.status(404).json({ message: "Fichier non trouvé" });
    res.json({ id: parseInt(id), name, message: "Fichier renommé avec succès" });
  });
});



// Dans server.js
app.get("/files/folder/:folderId", (req, res) => {
  const { folderId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  
  db.query(
    "SELECT SQL_CALC_FOUND_ROWS * FROM files WHERE folder_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [folderId, limit, offset],
    (err, results) => {
      if (err) {
        console.error("❌ Erreur GET /files/folder/:folderId:", err);
        return res.status(500).json({ message: "Erreur serveur" });
      }
      
      db.query("SELECT FOUND_ROWS() as total", (err, countResults) => {
        if (err) {
          return res.status(500).json({ message: "Erreur comptage" });
        }
        
        res.json({
          files: results,
          pagination: {
            page,
            limit,
            total: countResults[0].total,
            totalPages: Math.ceil(countResults[0].total / limit)
          }
        });
      });
    }
  );
});

// 📊 Statistiques
// app.get("/stats", (req, res) => {
//   db.query(`
//     SELECT 
//       (SELECT COUNT(*) FROM folders) as total_folders,
//       (SELECT COUNT(*) FROM files) as total_files,
//       (SELECT COALESCE(SUM(size), 0) FROM files) as total_storage
//   `, (err, results) => {
//     if (err) {
//       console.error("❌ Erreur GET /stats:", err);
//       return res.status(500).json({ message: "Erreur lors de la récupération des statistiques" });
//     }
//     res.json(results[0]);
//   });
// });


// Démarrage serveur
app.listen(3002, "0.0.0.0", () => console.log("🚀 API en écoute sur http://192.168.117.20:3002"));