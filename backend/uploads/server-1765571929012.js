
// backend/server.js
// HumaniTok - Backend API (Node.js + Express + MySQL)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================
// CONFIGURATION
// ============================================

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Désactivé pour faciliter le développement
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: '*', //['http://localhost:5000', 'http://localhost:8081', 'exp://192.168.*.*:8081'],
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limite chaque IP à 500 requêtes par fenêtre
  message: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.'
});
app.use('/api/', apiLimiter);

// Configuration uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuration Multer pour les fichiers
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let folder = 'general';
    if (file.fieldname === 'profile_picture') folder = 'profiles';
    else if (file.fieldname === 'video') folder = 'videos';
    else if (file.fieldname === 'thumbnail') folder = 'thumbnails';
    else if (file.fieldname.startsWith('attachment')) folder = 'attachments';

    const dir = path.join(uploadDir, folder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  // Images
  if (file.fieldname === 'profile_picture' || file.fieldname === 'thumbnail') {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées'), false);
    }
  }
  // Vidéos
  else if (file.fieldname === 'video') {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les vidéos sont autorisées'), false);
    }
  }
  // Documents
  else {
    // const allowedTypes = [
    //     'image/jpeg', 'image/png', 'image/gif',
    //     'video/mp4', 'video/quicktime',
    //     'application/pdf', 
    //     'application/msword',
    //     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    // ];
    // Types MIME élargis pour images, vidéos, audio et documents
    const allowedTypes = [

      // --- IMAGES ---
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/bmp',
      'image/heic',
      'image/heif',
      'image/tiff',

      // --- VIDEOS ---
      'video/mp4',
      'video/quicktime',          // MOV
      'video/x-m4v',
      'video/x-msvideo',          // AVI
      'video/x-ms-wmv',           // WMV
      'video/mpeg',
      'video/webm',
      'video/3gpp',
      'video/3gpp2',
      'video/ogg',

      // --- AUDIO ---
      'audio/mpeg',               // MP3
      'audio/mp4',                // M4A
      'audio/aac',
      'audio/wav',
      'audio/ogg',
      'audio/webm',
      'audio/flac',
      'audio/x-ms-wma',

      // --- DOCUMENTS ---
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',     // DOCX
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',           // XLSX
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',   // PPTX
      'text/plain',
      'text/csv',
      'application/zip',
      'application/x-rar-compressed'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé'), false);
    }
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB max
    files: 10 // Max 10 fichiers par requête
  }
});

// Configuration base de données
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'humanitok_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'humanitok-secret-key-change-in-production';

// ============================================
// UTILITAIRES
// ============================================

// Middleware d'authentification
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token d\'authentification manquant'
    });
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);

    // Vérifier que l'utilisateur existe toujours
    const [users] = await pool.execute(
      'SELECT id, uuid, username, email, user_type, account_status FROM users WHERE id = ?',
      [user.id]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur introuvable'
      });
    }

    if (users[0].account_status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Compte désactivé ou suspendu'
      });
    }

    req.user = users[0];
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Token invalide ou expiré'
    });
  }
};

// Middleware pour les organisations
const isOrganization = async (req, res, next) => {
  if (req.user.user_type !== 'organization') {
    return res.status(403).json({
      success: false,
      message: 'Accès réservé aux organisations'
    });
  }
  next();
};

// Générer URL publique
const getPublicUrl = (filePath) => {
  if (!filePath) return null;
  const relativePath = path.relative(__dirname, filePath);
  return `${process.env.APP_URL || 'http://localhost:5000'}/${relativePath.replace(/\\/g, '/')}`;
};

// Valider email
const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

// Formater les réponses
const formatResponse = (success, data, message = '') => {
  return { success, data, message };
};

// ============================================
// ROUTES D'AUTHENTIFICATION
// ============================================

// Inscription
app.post('/api/auth/register', upload.single('profile_picture'), async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      full_name,
      user_type = 'donor',
      bio,
      country_code,
      city
    } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json(formatResponse(false, null, 'Nom d\'utilisateur, email et mot de passe requis'));
    }

    if (!isValidEmail(email)) {
      return res.status(400).json(formatResponse(false, null, 'Email invalide'));
    }

    if (password.length < 6) {
      return res.status(400).json(formatResponse(false, null, 'Le mot de passe doit contenir au moins 6 caractères'));
    }

    // Vérifier si l'utilisateur existe déjà
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json(formatResponse(false, null, 'Nom d\'utilisateur ou email déjà utilisé'));
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);
    const userUuid = uuidv4();

    // Traiter l'image de profil
    let profilePictureUrl = null;
    if (req.file) {
      profilePictureUrl = getPublicUrl(req.file.path);
    }

    // Créer l'utilisateur
    const [result] = await pool.execute(
      `INSERT INTO users (
                uuid, username, email, password_hash, full_name, 
                bio, profile_picture_url, user_type, country_code, city,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        userUuid, username, email, hashedPassword, full_name,
        bio, profilePictureUrl, user_type, country_code, city
      ]
    );

    const userId = result.insertId;

    // Créer un profil d'organisation si nécessaire
    if (user_type === 'organization') {
      const {
        organization_name,
        organization_type,
        registration_number,
        legal_address,
        website_url
      } = req.body;

      if (!organization_name) {
        return res.status(400).json(formatResponse(false, null, 'Nom de l\'organisation requis'));
      }

      await pool.execute(
        `INSERT INTO organizations (
                    user_id, organization_name, organization_type,
                    registration_number, legal_address, website_url,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          userId, organization_name, organization_type || 'ngo',
          registration_number, legal_address, website_url
        ]
      );
    }

    // Créer le niveau utilisateur
    await pool.execute(
      'INSERT INTO user_levels (user_id, current_level, current_xp, xp_to_next_level) VALUES (?, 1, 0, 100)',
      [userId]
    );

    // Générer le token JWT
    const token = jwt.sign(
      { id: userId, email: email, user_type: user_type },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Récupérer l'utilisateur créé
    const [users] = await pool.execute(
      'SELECT id, uuid, username, email, full_name, user_type, profile_picture_url, humanitarian_score FROM users WHERE id = ?',
      [userId]
    );

    const userData = {
      ...users[0],
      token,
      has_profile_picture: !!profilePictureUrl
    };

    res.status(201).json(formatResponse(true, userData, 'Inscription réussie'));
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de l\'inscription'));
  }
});

// Connexion
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json(formatResponse(false, null, 'Email et mot de passe requis'));
    }

    // Récupérer l'utilisateur
    const [users] = await pool.execute(
      'SELECT id, uuid, username, email, password_hash, user_type, account_status FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json(formatResponse(false, null, 'Email ou mot de passe incorrect'));
    }

    const user = users[0];

    // Vérifier le statut du compte
    if (user.account_status !== 'active') {
      return res.status(403).json(formatResponse(false, null, 'Compte désactivé ou suspendu'));
    }

    // Vérifier le mot de passe
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json(formatResponse(false, null, 'Email ou mot de passe incorrect'));
    }

    // Mettre à jour la dernière connexion
    await pool.execute(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // Générer le token JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, user_type: user.user_type },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Récupérer les données complètes
    const [userData] = await pool.execute(
      `SELECT 
                u.id, u.uuid, u.username, u.email, u.full_name, u.bio,
                u.profile_picture_url, u.user_type, u.humanitarian_score,
                u.impact_points, u.followers_count, u.following_count,
                u.videos_count, u.total_donations, u.total_volunteer_hours,
                u.country_code, u.city, u.verified,
                COALESCE(o.organization_name, '') as organization_name,
                COALESCE(o.verification_level, 'basic') as organization_verification
            FROM users u
            LEFT JOIN organizations o ON u.id = o.user_id
            WHERE u.id = ?`,
      [user.id]
    );

    const responseData = {
      ...userData[0],
      token,
      has_profile_picture: !!userData[0].profile_picture_url
    };

    res.json(formatResponse(true, responseData, 'Connexion réussie'));
  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la connexion'));
  }
});

// Profil utilisateur
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const [userData] = await pool.execute(
      `SELECT 
                u.*,
                COALESCE(o.organization_name, '') as organization_name,
                COALESCE(o.verification_level, 'basic') as organization_verification,
                ul.current_level, ul.current_xp, ul.xp_to_next_level,
                ul.days_streak, ul.total_xp_earned
            FROM users u
            LEFT JOIN organizations o ON u.id = o.user_id
            LEFT JOIN user_levels ul ON u.id = ul.user_id
            WHERE u.id = ?`,
      [req.user.id]
    );

    // Récupérer les badges
    const [badges] = await pool.execute(
      `SELECT b.*, ub.awarded_at 
            FROM user_badges ub
            JOIN badges b ON ub.badge_id = b.id
            WHERE ub.user_id = ?
            ORDER BY ub.awarded_at DESC`,
      [req.user.id]
    );

    // Récupérer les statistiques récentes
    const [recentStats] = await pool.execute(
      `SELECT 
                COUNT(DISTINCT v.id) as recent_videos,
                COALESCE(SUM(d.amount), 0) as recent_donations,
                COUNT(DISTINCT ve.id) as recent_volunteer_activities
            FROM users u
            LEFT JOIN humanitarian_videos v ON u.id = v.user_id AND v.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            LEFT JOIN donations d ON u.id = d.donor_id AND d.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND d.status = 'completed'
            LEFT JOIN volunteer_engagements ve ON u.id = ve.volunteer_id AND ve.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            WHERE u.id = ?`,
      [req.user.id]
    );

    const responseData = {
      ...userData[0],
      badges,
      recent_stats: recentStats[0]
    };

    res.json(formatResponse(true, responseData));
  } catch (error) {
    console.error('Erreur profil:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la récupération du profil'));
  }
});

// ============================================
// ROUTES VIDÉOS
// ============================================

// Upload d'une vidéo humanitaire
app.post('/api/videos/upload',
  authenticateToken,
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
    { name: 'attachments', maxCount: 5 }
  ]),
  async (req, res) => {
    try {
      const {
        caption,
        description,
        cause_type,
        urgency_level = 'medium',
        location_name,
        country_code,
        latitude,
        longitude,
        impact_goal,
        impact_metric,
        target_value,
        project_id
      } = req.body;

      // Validation
      if (!req.files || !req.files.video) {
        return res.status(400).json(formatResponse(false, null, 'Vidéo requise'));
      }

      if (!cause_type) {
        return res.status(400).json(formatResponse(false, null, 'Type de cause humanitaire requis'));
      }

      const videoFile = req.files.video[0];
      const thumbnailFile = req.files.thumbnail ? req.files.thumbnail[0] : null;

      // Vérifier la durée de la vidéo (simulée)
      const durationSeconds = 60; // En production, utiliser ffprobe

      // Créer la vidéo
      const videoUuid = uuidv4();
      const videoUrl = getPublicUrl(videoFile.path);
      const thumbnailUrl = thumbnailFile ? getPublicUrl(thumbnailFile.path) : null;

      // Vérifier si c'est une organisation
      let organizationId = null;
      if (req.user.user_type === 'organization') {
        const [orgs] = await pool.execute(
          'SELECT id FROM organizations WHERE user_id = ?',
          [req.user.id]
        );
        if (orgs.length > 0) {
          organizationId = orgs[0].id;
        }
      }

      // Insérer la vidéo
      const [result] = await pool.execute(
        `INSERT INTO humanitarian_videos (
                uuid, user_id, organization_id, caption, description,
                video_url, thumbnail_url, duration_seconds, cause_type,
                urgency_level, location_name, country_code, latitude, longitude,
                impact_goal, impact_metric, target_value, project_id,
                status, approval_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          videoUuid, req.user.id, organizationId, caption, description,
          videoUrl, thumbnailUrl, durationSeconds, cause_type,
          urgency_level, location_name, country_code, latitude, longitude,
          impact_goal, impact_metric, target_value || 0, project_id,
          'published', 'approved' // En production: 'pending' pour modération
        ]
      );

      const videoId = result.insertId;

      // Mettre à jour le compteur de vidéos de l'utilisateur
      await pool.execute(
        'UPDATE users SET videos_count = videos_count + 1 WHERE id = ?',
        [req.user.id]
      );

      // Ajouter des points XP
      await pool.execute(
        'UPDATE user_levels SET current_xp = current_xp + 50, total_xp_earned = total_xp_earned + 50 WHERE user_id = ?',
        [req.user.id]
      );

      // Récupérer la vidéo créée
      const [videos] = await pool.execute(
        `SELECT 
                hv.*,
                u.username,
                u.profile_picture_url,
                COALESCE(o.organization_name, '') as organization_name
            FROM humanitarian_videos hv
            JOIN users u ON hv.user_id = u.id
            LEFT JOIN organizations o ON hv.organization_id = o.id
            WHERE hv.id = ?`,
        [videoId]
      );

      res.status(201).json(formatResponse(true, videos[0], 'Vidéo publiée avec succès'));
    } catch (error) {
      console.error('Erreur upload vidéo:', error);
      res.status(500).json(formatResponse(false, null, 'Erreur lors de l\'upload de la vidéo'));
    }
  });

// Feed de vidéos (Pour Toi)
app.get('/api/videos/feed', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, cause_type, country_code } = req.query;
    const offset = (page - 1) * limit;

    let query = `
            SELECT 
                hv.*,
                u.username,
                u.profile_picture_url,
                COALESCE(o.organization_name, '') as organization_name,
                COALESCE(o.verification_level, 'basic') as organization_verification,
                (hv.likes_count + hv.shares_count * 2 + hv.donations_count * 3) as engagement_score,
                EXISTS(SELECT 1 FROM video_likes vl WHERE vl.video_id = hv.id AND vl.user_id = ?) as user_liked
            FROM humanitarian_videos hv
            JOIN users u ON hv.user_id = u.id
            LEFT JOIN organizations o ON hv.organization_id = o.id
            WHERE hv.status = 'published' 
            AND hv.approval_status = 'approved'
            AND u.account_status = 'active'
        `;

    const queryParams = [req.user.id];

    // Filtres
    if (cause_type) {
      query += ' AND hv.cause_type = ?';
      queryParams.push(cause_type);
    }

    if (country_code) {
      query += ' AND (hv.country_code = ? OR hv.country_code IS NULL)';
      queryParams.push(country_code);
    }

    // Ordre: urgent d'abord, puis engagement
    query += ` ORDER BY 
            CASE hv.urgency_level 
                WHEN 'critical' THEN 4
                WHEN 'high' THEN 3
                WHEN 'medium' THEN 2
                ELSE 1
            END DESC,
            engagement_score DESC,
            hv.published_at DESC
            LIMIT ? OFFSET ?`;

    queryParams.push(parseInt(limit), parseInt(offset));

    const [videos] = await pool.execute(query, queryParams);

    // Incrémenter les vues pour chaque vidéo
    const updatePromises = videos.map(video =>
      pool.execute(
        'UPDATE humanitarian_videos SET views_count = views_count + 1 WHERE id = ?',
        [video.id]
      )
    );
    await Promise.all(updatePromises);

    // Statistiques du feed
    const [stats] = await pool.execute(
      `SELECT 
                COUNT(*) as total_videos,
                COUNT(DISTINCT cause_type) as unique_causes,
                COALESCE(SUM(donation_amount), 0) as total_funds_raised
            FROM humanitarian_videos
            WHERE status = 'published' AND approval_status = 'approved'`
    );

    res.json(formatResponse(true, {
      videos,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: stats[0].total_videos,
        total_pages: Math.ceil(stats[0].total_videos / limit)
      },
      stats: stats[0]
    }));
  } catch (error) {
    console.error('Erreur feed vidéos:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la récupération du feed'));
  }
});

// Vidéo spécifique
app.get('/api/videos/:video_uuid', authenticateToken, async (req, res) => {
  try {
    const { video_uuid } = req.params;

    const [videos] = await pool.execute(
      `SELECT 
                hv.*,
                u.username,
                u.profile_picture_url,
                u.user_type,
                COALESCE(o.organization_name, '') as organization_name,
                COALESCE(o.verification_level, 'basic') as organization_verification,
                p.project_name,
                p.project_description,
                EXISTS(SELECT 1 FROM video_likes vl WHERE vl.video_id = hv.id AND vl.user_id = ?) as user_liked,
                EXISTS(SELECT 1 FROM user_follows uf WHERE uf.follower_id = ? AND uf.following_id = u.id) as user_following
            FROM humanitarian_videos hv
            JOIN users u ON hv.user_id = u.id
            LEFT JOIN organizations o ON hv.organization_id = o.id
            LEFT JOIN humanitarian_projects p ON hv.project_id = p.id
            WHERE hv.uuid = ? AND hv.status = 'published'`,
      [req.user.id, req.user.id, video_uuid]
    );

    if (videos.length === 0) {
      return res.status(404).json(formatResponse(false, null, 'Vidéo non trouvée'));
    }

    const video = videos[0];

    // Incrémenter les vues
    await pool.execute(
      'UPDATE humanitarian_videos SET views_count = views_count + 1 WHERE id = ?',
      [video.id]
    );

    // Récupérer les commentaires récents
    const [comments] = await pool.execute(
      `SELECT 
                vc.*,
                u.username,
                u.profile_picture_url,
                EXISTS(SELECT 1 FROM video_likes cl WHERE cl.video_id = vc.video_id AND cl.user_id = ?) as user_liked_comment
            FROM video_comments vc
            JOIN users u ON vc.user_id = u.id
            WHERE vc.video_id = ? AND vc.hidden = FALSE
            ORDER BY vc.created_at DESC
            LIMIT 50`,
      [req.user.id, video.id]
    );

    // Récupérer les dons récents
    const [recentDonations] = await pool.execute(
      `SELECT 
                d.*,
                u.username,
                u.profile_picture_url
            FROM donations d
            JOIN users u ON d.donor_id = u.id
            WHERE d.video_id = ? AND d.status = 'completed' AND d.is_anonymous = FALSE
            ORDER BY d.created_at DESC
            LIMIT 10`,
      [video.id]
    );

    res.json(formatResponse(true, {
      video,
      comments,
      recent_donations: recentDonations,
      comment_count: comments.length
    }));
  } catch (error) {
    console.error('Erreur vidéo spécifique:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la récupération de la vidéo'));
  }
});

// Like/Unlike une vidéo
app.post('/api/videos/:video_uuid/like', authenticateToken, async (req, res) => {
  try {
    const { video_uuid } = req.params;

    // Récupérer l'ID de la vidéo
    const [videos] = await pool.execute(
      'SELECT id FROM humanitarian_videos WHERE uuid = ?',
      [video_uuid]
    );

    if (videos.length === 0) {
      return res.status(404).json(formatResponse(false, null, 'Vidéo non trouvée'));
    }

    const videoId = videos[0].id;

    // Vérifier si l'utilisateur a déjà liké
    const [existingLikes] = await pool.execute(
      'SELECT id FROM video_likes WHERE user_id = ? AND video_id = ?',
      [req.user.id, videoId]
    );

    if (existingLikes.length > 0) {
      // Unlike
      await pool.execute(
        'DELETE FROM video_likes WHERE user_id = ? AND video_id = ?',
        [req.user.id, videoId]
      );

      await pool.execute(
        'UPDATE humanitarian_videos SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = ?',
        [videoId]
      );

      res.json(formatResponse(true, { liked: false }, 'Like retiré'));
    } else {
      // Like
      await pool.execute(
        'INSERT INTO video_likes (user_id, video_id, like_type, created_at) VALUES (?, ?, ?, NOW())',
        [req.user.id, videoId, 'like']
      );

      // Le trigger s'occupe d'incrémenter le compteur

      res.json(formatResponse(true, { liked: true }, 'Vidéo likée'));
    }
  } catch (error) {
    console.error('Erreur like:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors du like'));
  }
});

// Commenter une vidéo
app.post('/api/videos/:video_uuid/comments', authenticateToken, async (req, res) => {
  try {
    const { video_uuid } = req.params;
    const { content, parent_comment_id } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json(formatResponse(false, null, 'Commentaire vide'));
    }

    // Récupérer l'ID de la vidéo
    const [videos] = await pool.execute(
      'SELECT id FROM humanitarian_videos WHERE uuid = ?',
      [video_uuid]
    );

    if (videos.length === 0) {
      return res.status(404).json(formatResponse(false, null, 'Vidéo non trouvée'));
    }

    const videoId = videos[0].id;
    const commentUuid = uuidv4();

    // Insérer le commentaire
    const [result] = await pool.execute(
      `INSERT INTO video_comments (
                uuid, user_id, video_id, parent_comment_id, content,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [commentUuid, req.user.id, videoId, parent_comment_id || null, content.trim()]
    );

    const commentId = result.insertId;

    // Mettre à jour le compteur de commentaires
    await pool.execute(
      'UPDATE humanitarian_videos SET comments_count = comments_count + 1 WHERE id = ?',
      [videoId]
    );

    // Mettre à jour le compteur de réponses si c'est une réponse
    if (parent_comment_id) {
      await pool.execute(
        'UPDATE video_comments SET replies_count = replies_count + 1 WHERE id = ?',
        [parent_comment_id]
      );
    }

    // Ajouter des points XP
    await pool.execute(
      'UPDATE user_levels SET current_xp = current_xp + 5, total_xp_earned = total_xp_earned + 5 WHERE user_id = ?',
      [req.user.id]
    );

    // Récupérer le commentaire créé
    const [comments] = await pool.execute(
      `SELECT 
                vc.*,
                u.username,
                u.profile_picture_url
            FROM video_comments vc
            JOIN users u ON vc.user_id = u.id
            WHERE vc.id = ?`,
      [commentId]
    );

    res.status(201).json(formatResponse(true, comments[0], 'Commentaire ajouté'));
  } catch (error) {
    console.error('Erreur commentaire:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de l\'ajout du commentaire'));
  }
});

// ============================================
// ROUTES PROJETS HUMANITAIRES
// ============================================

// Créer un projet humanitaire
app.post('/api/projects', authenticateToken, isOrganization, async (req, res) => {
  try {
    const {
      project_name,
      project_description,
      detailed_description,
      category,
      subcategories,
      country_codes,
      regions,
      specific_locations,
      goal_description,
      target_beneficiaries,
      timeframe_months,
      total_budget_needed,
      budget_breakdown,
      start_date,
      expected_end_date,
      updates_frequency
    } = req.body;

    // Validation
    if (!project_name || !project_description || !category) {
      return res.status(400).json(formatResponse(false, null, 'Nom, description et catégorie requis'));
    }

    if (!total_budget_needed || total_budget_needed <= 0) {
      return res.status(400).json(formatResponse(false, null, 'Budget total requis et doit être positif'));
    }

    // Récupérer l'ID de l'organisation
    const [organizations] = await pool.execute(
      'SELECT id FROM organizations WHERE user_id = ?',
      [req.user.id]
    );

    if (organizations.length === 0) {
      return res.status(400).json(formatResponse(false, null, 'Organisation non trouvée'));
    }

    const organizationId = organizations[0].id;
    const projectUuid = uuidv4();

    // Parser les données JSON
    const subcategoriesJson = subcategories ? JSON.stringify(subcategories) : '[]';
    const countryCodesJson = country_codes ? JSON.stringify(country_codes) : '[]';
    const regionsJson = regions ? JSON.stringify(regions) : '[]';
    const budgetBreakdownJson = budget_breakdown ? JSON.stringify(budget_breakdown) : '{}';

    // Créer le projet
    const [result] = await pool.execute(
      `INSERT INTO humanitarian_projects (
                uuid, organization_id, created_by_user_id,
                project_name, project_description, detailed_description,
                category, subcategories, country_codes, regions, specific_locations,
                goal_description, target_beneficiaries, timeframe_months,
                total_budget_needed, budget_breakdown, start_date, expected_end_date,
                updates_frequency, status, progress_percentage,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, NOW(), NOW())`,
      [
        projectUuid, organizationId, req.user.id,
        project_name, project_description, detailed_description,
        category, subcategoriesJson, countryCodesJson, regionsJson, specific_locations,
        goal_description, target_beneficiaries || 0, timeframe_months || 12,
        total_budget_needed, budgetBreakdownJson, start_date, expected_end_date,
        updates_frequency || 'monthly'
      ]
    );

    const projectId = result.insertId;

    // Mettre à jour le compteur de projets de l'organisation
    await pool.execute(
      'UPDATE organizations SET total_projects = total_projects + 1 WHERE id = ?',
      [organizationId]
    );

    // Récupérer le projet créé
    const [projects] = await pool.execute(
      `SELECT 
                hp.*,
                o.organization_name,
                o.verification_level,
                u.username as created_by_username
            FROM humanitarian_projects hp
            JOIN organizations o ON hp.organization_id = o.id
            JOIN users u ON hp.created_by_user_id = u.id
            WHERE hp.id = ?`,
      [projectId]
    );

    res.status(201).json(formatResponse(true, projects[0], 'Projet créé avec succès'));
  } catch (error) {
    console.error('Erreur création projet:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la création du projet'));
  }
});

// Lister les projets
app.get('/api/projects', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      status,
      country_code,
      featured,
      urgent
    } = req.query;

    const offset = (page - 1) * limit;

    let query = `
            SELECT 
                hp.*,
                o.organization_name,
                o.verification_level,
                (hp.total_budget_needed - hp.funds_raised) as funding_gap,
                CASE 
                    WHEN hp.expected_end_date IS NOT NULL 
                    THEN DATEDIFF(hp.expected_end_date, CURDATE())
                    ELSE 999
                END as days_remaining,
                hp.funds_raised / hp.total_budget_needed * 100 as funding_percentage
            FROM humanitarian_projects hp
            JOIN organizations o ON hp.organization_id = o.id
            WHERE o.verified_by_admin = TRUE
        `;

    const queryParams = [];

    // Filtres
    if (category) {
      query += ' AND hp.category = ?';
      queryParams.push(category);
    }

    if (status) {
      query += ' AND hp.status = ?';
      queryParams.push(status);
    }

    if (country_code) {
      query += ' AND JSON_CONTAINS(hp.country_codes, ?)';
      queryParams.push(JSON.stringify(country_code));
    }

    if (featured === 'true') {
      query += ' AND hp.featured = TRUE';
    }

    if (urgent === 'true') {
      query += ' AND hp.status = "active" AND (hp.total_budget_needed - hp.funds_raised) > (hp.total_budget_needed * 0.5)';
    }

    // Ordre
    if (urgent === 'true') {
      query += ' ORDER BY funding_gap DESC, days_remaining ASC';
    } else {
      query += ' ORDER BY hp.featured DESC, hp.created_at DESC';
    }

    query += ' LIMIT ? OFFSET ?';
    queryParams.push(parseInt(limit), parseInt(offset));

    const [projects] = await pool.execute(query, queryParams);

    // Compter le total
    let countQuery = 'SELECT COUNT(*) as total FROM humanitarian_projects hp JOIN organizations o ON hp.organization_id = o.id WHERE o.verified_by_admin = TRUE';
    const countParams = [];

    // Appliquer les mêmes filtres
    if (category) {
      countQuery += ' AND hp.category = ?';
      countParams.push(category);
    }

    if (status) {
      countQuery += ' AND hp.status = ?';
      countParams.push(status);
    }

    if (country_code) {
      countQuery += ' AND JSON_CONTAINS(hp.country_codes, ?)';
      countParams.push(JSON.stringify(country_code));
    }

    if (featured === 'true') {
      countQuery += ' AND hp.featured = TRUE';
    }

    if (urgent === 'true') {
      countQuery += ' AND hp.status = "active" AND (hp.total_budget_needed - hp.funds_raised) > (hp.total_budget_needed * 0.5)';
    }

    const [countResult] = await pool.execute(countQuery, countParams);

    res.json(formatResponse(true, {
      projects,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        total_pages: Math.ceil(countResult[0].total / limit)
      }
    }));
  } catch (error) {
    console.error('Erreur liste projets:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la récupération des projets'));
  }
});

// ============================================
// ROUTES DONS
// ============================================

// Faire un don
app.post('/api/donations', authenticateToken, async (req, res) => {
  try {
    const {
      amount,
      currency = 'EUR',
      video_id,
      project_id,
      organization_id,
      donation_type = 'one_time',
      is_anonymous = false,
      show_amount_publicly = true,
      payment_method = 'credit_card'
    } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json(formatResponse(false, null, 'Montant invalide'));
    }

    if (!organization_id) {
      return res.status(400).json(formatResponse(false, null, 'Organisation requise'));
    }

    // Vérifier l'organisation
    const [organizations] = await pool.execute(
      'SELECT id FROM organizations WHERE id = ? AND verified_by_admin = TRUE',
      [organization_id]
    );

    if (organizations.length === 0) {
      return res.status(404).json(formatResponse(false, null, 'Organisation non trouvée ou non vérifiée'));
    }

    // Vérifier la vidéo si spécifiée
    if (video_id) {
      const [videos] = await pool.execute(
        'SELECT id FROM humanitarian_videos WHERE id = ? AND status = "published"',
        [video_id]
      );
      if (videos.length === 0) {
        return res.status(404).json(formatResponse(false, null, 'Vidéo non trouvée'));
      }
    }

    // Vérifier le projet si spécifié
    if (project_id) {
      const [projects] = await pool.execute(
        'SELECT id FROM humanitarian_projects WHERE id = ? AND status = "active"',
        [project_id]
      );
      if (projects.length === 0) {
        return res.status(404).json(formatResponse(false, null, 'Projet non trouvé ou inactif'));
      }
    }

    const donationUuid = uuidv4();
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Simuler un paiement (en production, intégrer Stripe, PayPal, etc.)
    // Ici on simule un paiement réussi
    const paymentStatus = 'authorized';

    // Créer le don
    const [result] = await pool.execute(
      `INSERT INTO donations (
                uuid, donor_id, video_id, project_id, organization_id,
                amount, currency, donation_type, is_anonymous,
                show_amount_publicly, payment_method, transaction_id,
                status, payment_status, impact_description,
                created_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, NOW(), NOW())`,
      [
        donationUuid, req.user.id, video_id || null, project_id || null, organization_id,
        amount, currency, donation_type, is_anonymous,
        show_amount_publicly, payment_method, transactionId,
        paymentStatus, `A contribué ${amount}${currency} à une cause humanitaire`
      ]
    );

    const donationId = result.insertId;

    // Le trigger s'occupe des mises à jour des compteurs

    // Envoyer une notification à l'organisation
    await pool.execute(
      `INSERT INTO notifications (
                user_id, notification_type, title, message, data,
                related_donation_id, delivery_method, created_at
            ) VALUES (
                (SELECT user_id FROM organizations WHERE id = ?),
                'new_donation',
                'Nouveau don reçu !',
                'Un don de ${amount}${currency} a été effectué sur votre projet.',
                ?,
                ?,
                'in_app',
                NOW()
            )`,
      [organization_id, JSON.stringify({ amount, currency, donor_id: req.user.id }), donationId]
    );

    // Récupérer le don créé
    const [donations] = await pool.execute(
      `SELECT 
                d.*,
                u.username as donor_username,
                o.organization_name,
                COALESCE(v.caption, '') as video_caption,
                COALESCE(p.project_name, '') as project_name
            FROM donations d
            JOIN users u ON d.donor_id = u.id
            JOIN organizations o ON d.organization_id = o.id
            LEFT JOIN humanitarian_videos v ON d.video_id = v.id
            LEFT JOIN humanitarian_projects p ON d.project_id = p.id
            WHERE d.id = ?`,
      [donationId]
    );

    res.status(201).json(formatResponse(true, donations[0], 'Don effectué avec succès'));
  } catch (error) {
    console.error('Erreur don:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors du traitement du don'));
  }
});

// Historique des dons
app.get('/api/donations/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [donations] = await pool.execute(
      `SELECT 
                d.*,
                o.organization_name,
                COALESCE(v.caption, '') as video_caption,
                COALESCE(p.project_name, '') as project_name
            FROM donations d
            JOIN organizations o ON d.organization_id = o.id
            LEFT JOIN humanitarian_videos v ON d.video_id = v.id
            LEFT JOIN humanitarian_projects p ON d.project_id = p.id
            WHERE d.donor_id = ? AND d.status = 'completed'
            ORDER BY d.created_at DESC
            LIMIT ? OFFSET ?`,
      [req.user.id, parseInt(limit), parseInt(offset)]
    );

    // Total des dons
    const [totalResult] = await pool.execute(
      'SELECT COUNT(*) as total, COALESCE(SUM(amount), 0) as total_amount FROM donations WHERE donor_id = ? AND status = "completed"',
      [req.user.id]
    );

    res.json(formatResponse(true, {
      donations,
      summary: totalResult[0],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalResult[0].total,
        total_pages: Math.ceil(totalResult[0].total / limit)
      }
    }));
  } catch (error) {
    console.error('Erreur historique dons:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la récupération de l\'historique'));
  }
});

// ============================================
// ROUTES BÉNÉVOLAT
// ============================================

// Postuler comme bénévole
app.post('/api/volunteer/apply', authenticateToken, async (req, res) => {
  try {
    const {
      project_id,
      role,
      responsibilities,
      commitment_hours_per_week,
      commitment_duration_weeks,
      engagement_type = 'remote',
      location_requirements,
      required_skills,
      required_languages
    } = req.body;

    // Validation
    if (!project_id) {
      return res.status(400).json(formatResponse(false, null, 'Projet requis'));
    }

    if (!role) {
      return res.status(400).json(formatResponse(false, null, 'Rôle requis'));
    }

    // Vérifier le projet
    const [projects] = await pool.execute(
      `SELECT 
                p.*,
                o.user_id as organization_user_id
            FROM humanitarian_projects p
            JOIN organizations o ON p.organization_id = o.id
            WHERE p.id = ? AND p.status = 'active'`,
      [project_id]
    );

    if (projects.length === 0) {
      return res.status(404).json(formatResponse(false, null, 'Projet non trouvé ou inactif'));
    }

    const project = projects[0];
    const volunteerUuid = uuidv4();

    // Parser les données JSON
    const skillsJson = required_skills ? JSON.stringify(required_skills) : '[]';
    const languagesJson = required_languages ? JSON.stringify(required_languages) : '[]';

    // Créer la candidature
    const [result] = await pool.execute(
      `INSERT INTO volunteer_engagements (
                uuid, volunteer_id, project_id, organization_id,
                role, responsibilities, commitment_hours_per_week,
                commitment_duration_weeks, engagement_type, location_requirements,
                required_skills, required_languages, status, application_date,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURDATE(), NOW(), NOW())`,
      [
        volunteerUuid, req.user.id, project_id, project.organization_id,
        role, responsibilities || '', commitment_hours_per_week || 10,
        commitment_duration_weeks || 12, engagement_type, location_requirements || '',
        skillsJson, languagesJson
      ]
    );

    const engagementId = result.insertId;

    // Envoyer une notification à l'organisation
    await pool.execute(
      `INSERT INTO notifications (
                user_id, notification_type, title, message, data,
                related_project_id, delivery_method, created_at
            ) VALUES (
                ?,
                'volunteer_application',
                'Nouvelle candidature de bénévole',
                'Une nouvelle personne souhaite devenir bénévole sur votre projet.',
                ?,
                ?,
                'in_app',
                NOW()
            )`,
      [project.organization_user_id, JSON.stringify({ volunteer_id: req.user.id, role }), project_id]
    );

    res.status(201).json(formatResponse(true, {
      engagement_id: engagementId,
      status: 'pending'
    }, 'Candidature envoyée avec succès'));
  } catch (error) {
    console.error('Erreur candidature bénévole:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de l\'envoi de la candidature'));
  }
});

// ============================================
// ROUTES ORGANISATIONS
// ============================================

// Récupérer les organisations vérifiées
app.get('/api/organizations', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, verification_level, organization_type } = req.query;
    const offset = (page - 1) * limit;

    let query = `
            SELECT 
                o.*,
                u.username,
                u.profile_picture_url,
                u.country_code,
                COUNT(DISTINCT p.id) as active_projects_count,
                COALESCE(SUM(p.funds_raised), 0) as total_funds_raised
            FROM organizations o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN humanitarian_projects p ON o.id = p.organization_id AND p.status = 'active'
            WHERE o.verified_by_admin = TRUE AND u.account_status = 'active'
        `;

    const queryParams = [];

    if (verification_level) {
      query += ' AND o.verification_level = ?';
      queryParams.push(verification_level);
    }

    if (organization_type) {
      query += ' AND o.organization_type = ?';
      queryParams.push(organization_type);
    }

    query += ` GROUP BY o.id
            ORDER BY o.verification_level DESC, active_projects_count DESC
            LIMIT ? OFFSET ?`;

    queryParams.push(parseInt(limit), parseInt(offset));

    const [organizations] = await pool.execute(query, queryParams);

    // Compter le total
    let countQuery = `
            SELECT COUNT(*) as total 
            FROM organizations o
            JOIN users u ON o.user_id = u.id
            WHERE o.verified_by_admin = TRUE AND u.account_status = 'active'
        `;

    const countParams = [];

    if (verification_level) {
      countQuery += ' AND o.verification_level = ?';
      countParams.push(verification_level);
    }

    if (organization_type) {
      countQuery += ' AND o.organization_type = ?';
      countParams.push(organization_type);
    }

    const [countResult] = await pool.execute(countQuery, countParams);

    res.json(formatResponse(true, {
      organizations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        total_pages: Math.ceil(countResult[0].total / limit)
      }
    }));
  } catch (error) {
    console.error('Erreur organisations:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la récupération des organisations'));
  }
});

// ============================================
// ROUTES STATISTIQUES
// ============================================

// Statistiques globales
app.get('/api/stats/global', authenticateToken, async (req, res) => {
  try {
    // Récupérer les statistiques globales
    const [globalStats] = await pool.execute(`
            SELECT 
                (SELECT COUNT(*) FROM users WHERE account_status = 'active') as total_users,
                (SELECT COUNT(*) FROM organizations WHERE verified_by_admin = TRUE) as total_organizations,
                (SELECT COUNT(*) FROM humanitarian_videos WHERE status = 'published' AND approval_status = 'approved') as total_videos,
                (SELECT COUNT(*) FROM humanitarian_projects WHERE status = 'active') as active_projects,
                (SELECT COALESCE(SUM(amount), 0) FROM donations WHERE status = 'completed') as total_donations,
                (SELECT COALESCE(SUM(hours_logged), 0) FROM volunteer_engagements WHERE status = 'completed') as total_volunteer_hours,
                (SELECT COUNT(DISTINCT country_code) FROM users WHERE country_code IS NOT NULL) as countries_reached
        `);

    // Dons par catégorie
    const [donationsByCategory] = await pool.execute(`
            SELECT 
                hv.cause_type,
                COUNT(DISTINCT d.id) as donation_count,
                COALESCE(SUM(d.amount), 0) as total_amount
            FROM donations d
            LEFT JOIN humanitarian_videos hv ON d.video_id = hv.id
            WHERE d.status = 'completed'
            GROUP BY hv.cause_type
            ORDER BY total_amount DESC
        `);

    // Projets urgents
    const [urgentProjects] = await pool.execute(`
            SELECT 
                hp.project_name,
                o.organization_name,
                (hp.total_budget_needed - hp.funds_raised) as funding_gap,
                hp.funds_raised / hp.total_budget_needed * 100 as funding_percentage
            FROM humanitarian_projects hp
            JOIN organizations o ON hp.organization_id = o.id
            WHERE hp.status = 'active'
            AND (hp.total_budget_needed - hp.funds_raised) > (hp.total_budget_needed * 0.5)
            ORDER BY funding_gap DESC
            LIMIT 5
        `);

    // Top donateurs
    const [topDonors] = await pool.execute(`
            SELECT 
                u.username,
                u.profile_picture_url,
                COALESCE(SUM(d.amount), 0) as total_donated
            FROM donations d
            JOIN users u ON d.donor_id = u.id
            WHERE d.status = 'completed'
            GROUP BY d.donor_id, u.username, u.profile_picture_url
            ORDER BY total_donated DESC
            LIMIT 10
        `);

    res.json(formatResponse(true, {
      global: globalStats[0],
      donations_by_category: donationsByCategory,
      urgent_projects: urgentProjects,
      top_donors: topDonors
    }));
  } catch (error) {
    console.error('Erreur statistiques:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la récupération des statistiques'));
  }
});

// Statistiques personnelles
app.get('/api/stats/personal', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [personalStats] = await pool.execute(`
            SELECT 
                (SELECT COUNT(*) FROM donations WHERE donor_id = ? AND status = 'completed') as total_donations_count,
                (SELECT COALESCE(SUM(amount), 0) FROM donations WHERE donor_id = ? AND status = 'completed') as total_donations_amount,
                (SELECT COUNT(*) FROM volunteer_engagements WHERE volunteer_id = ? AND status IN ('active', 'completed')) as total_volunteer_engagements,
                (SELECT COALESCE(SUM(hours_logged), 0) FROM volunteer_engagements WHERE volunteer_id = ? AND status = 'completed') as total_volunteer_hours,
                (SELECT COUNT(*) FROM humanitarian_videos WHERE user_id = ? AND status = 'published') as total_videos_uploaded,
                (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) as following_count,
                (SELECT COUNT(*) FROM user_follows WHERE following_id = ?) as followers_count,
                (SELECT COALESCE(SUM(views_count), 0) FROM humanitarian_videos WHERE user_id = ?) as total_video_views
        `, [
      userId, userId, userId, userId,
      userId, userId, userId, userId
    ]);

    // Dons mensuels
    const [monthlyDonations] = await pool.execute(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as donation_count,
                COALESCE(SUM(amount), 0) as total_amount
            FROM donations 
            WHERE donor_id = ? AND status = 'completed'
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month DESC
            LIMIT 6
        `, [userId]);

    // Badges récents
    const [recentBadges] = await pool.execute(`
            SELECT 
                b.*,
                ub.awarded_at
            FROM user_badges ub
            JOIN badges b ON ub.badge_id = b.id
            WHERE ub.user_id = ?
            ORDER BY ub.awarded_at DESC
            LIMIT 5
        `, [userId]);

    res.json(formatResponse(true, {
      personal: personalStats[0],
      monthly_donations: monthlyDonations,
      recent_badges: recentBadges
    }));
  } catch (error) {
    console.error('Erreur statistiques personnelles:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la récupération des statistiques personnelles'));
  }
});

// ============================================
// ROUTES UTILITAIRES
// ============================================

// Recherche
app.get('/api/search', authenticateToken, async (req, res) => {
  try {
    const { q, type = 'all', page = 1, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json(formatResponse(false, null, 'Requête de recherche trop courte'));
    }

    const searchTerm = `%${q.trim()}%`;
    const offset = (page - 1) * limit;
    let results = {};

    // Recherche dans les vidéos
    if (type === 'all' || type === 'videos') {
      const [videos] = await pool.execute(`
                SELECT 
                    hv.*,
                    u.username,
                    u.profile_picture_url,
                    o.organization_name
                FROM humanitarian_videos hv
                JOIN users u ON hv.user_id = u.id
                LEFT JOIN organizations o ON hv.organization_id = o.id
                WHERE (hv.caption LIKE ? OR hv.description LIKE ?)
                AND hv.status = 'published' AND hv.approval_status = 'approved'
                ORDER BY hv.published_at DESC
                LIMIT ? OFFSET ?
            `, [searchTerm, searchTerm, parseInt(limit), parseInt(offset)]);

      results.videos = videos;
    }

    // Recherche dans les projets
    if (type === 'all' || type === 'projects') {
      const [projects] = await pool.execute(`
                SELECT 
                    hp.*,
                    o.organization_name,
                    o.verification_level
                FROM humanitarian_projects hp
                JOIN organizations o ON hp.organization_id = o.id
                WHERE (hp.project_name LIKE ? OR hp.project_description LIKE ?)
                AND o.verified_by_admin = TRUE
                ORDER BY hp.created_at DESC
                LIMIT ? OFFSET ?
            `, [searchTerm, searchTerm, parseInt(limit), parseInt(offset)]);

      results.projects = projects;
    }

    // Recherche dans les organisations
    if (type === 'all' || type === 'organizations') {
      const [organizations] = await pool.execute(`
                SELECT 
                    o.*,
                    u.username,
                    u.profile_picture_url
                FROM organizations o
                JOIN users u ON o.user_id = u.id
                WHERE (o.organization_name LIKE ?)
                AND o.verified_by_admin = TRUE
                ORDER BY o.verification_level DESC
                LIMIT ? OFFSET ?
            `, [searchTerm, parseInt(limit), parseInt(offset)]);

      results.organizations = organizations;
    }

    // Recherche dans les utilisateurs
    if (type === 'all' || type === 'users') {
      const [users] = await pool.execute(`
                SELECT 
                    id, uuid, username, profile_picture_url, 
                    user_type, humanitarian_score, bio
                FROM users
                WHERE (username LIKE ? OR full_name LIKE ?)
                AND account_status = 'active'
                ORDER BY humanitarian_score DESC
                LIMIT ? OFFSET ?
            `, [searchTerm, searchTerm, parseInt(limit), parseInt(offset)]);

      results.users = users;
    }

    res.json(formatResponse(true, results));
  } catch (error) {
    console.error('Erreur recherche:', error);
    res.status(500).json(formatResponse(false, null, 'Erreur lors de la recherche'));
  }
});

// Télécharger un fichier
app.get('/api/files/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadDir, filename);

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json(formatResponse(false, null, 'Fichier non trouvé'));
  }
});

// ============================================
// ROUTES DE SANTÉ
// ============================================

// Health check
app.get('/api/health', async (req, res) => {
  try {
    // Tester la connexion à la base de données
    await pool.execute('SELECT 1');

    // Vérifier l'espace disque
    const diskInfo = {
      total_space: 'N/A',
      free_space: 'N/A',
      uploads_exists: fs.existsSync(uploadDir)
    };

    res.json(formatResponse(true, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      disk: diskInfo,
      environment: process.env.NODE_ENV || 'development'
    }));
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json(formatResponse(false, null, 'Service unhealthy: ' + error.message));
  }
});

// ============================================
// GESTION DES ERREURS
// ============================================

// Gestion des erreurs Multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json(formatResponse(false, null, 'Fichier trop volumineux (max 200MB)'));
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json(formatResponse(false, null, 'Trop de fichiers envoyés'));
    }
    return res.status(400).json(formatResponse(false, null, 'Erreur lors de l\'upload: ' + error.message));
  } else if (error) {
    return res.status(400).json(formatResponse(false, null, error.message));
  }
  next();
});

// 404 - Route non trouvée
app.use('/api/*', (req, res) => {
  res.status(404).json(formatResponse(false, null, 'Route API non trouvée'));
});

// Gestion des erreurs globales
app.use((error, req, res, next) => {
  console.error('Erreur globale:', error);
  res.status(500).json(formatResponse(false, null, 'Erreur interne du serveur'));
});

// ============================================
// DÉMARRAGE DU SERVEUR
// ============================================

// Créer les dossiers nécessaires
const folders = ['profiles', 'videos', 'thumbnails', 'attachments', 'general'];
folders.forEach(folder => {
  const dir = path.join(uploadDir, folder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`
    ============================================
    HUMANITOK BACKEND SERVER
    ============================================
    Serveur démarré sur le port: ${PORT}
    Environnement: ${process.env.NODE_ENV || 'development'}
    URL API: http://localhost:${PORT}/api
    Dossier uploads: ${uploadDir}
    ============================================
    `);
});

// Gestion propre de l'arrêt
process.on('SIGTERM', async () => {
  console.log('Fermeture du serveur...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Arrêt du serveur...');
  await pool.end();
  process.exit(0);
});

module.exports = app;