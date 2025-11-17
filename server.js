// ============================================
// BUG RUSH BACKEND API
// Node.js + Express + MySQL
// ============================================

// Install required packages first:
// npm install express mysql2 cors body-parser dotenv

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database Configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bug_rush',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// ============================================
// API ENDPOINTS
// ============================================

// Test endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Bug Rush API is running!',
        version: '1.0.0'
    });
});

// ============================================
// 1. REGISTER PARTICIPANT
// ============================================
app.post('/api/register', async (req, res) => {
    try {
        const { 
            teamName, 
            participantName, 
            email, 
            phone, 
            language, 
            experience, 
            teamType 
        } = req.body;

        // Validation
        if (!teamName || !participantName || !email || !phone || !language || !experience || !teamType) {
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required!' 
            });
        }

        // Check if email already exists
        const [existingUser] = await pool.query(
            'SELECT id FROM participants WHERE email = ?',
            [email]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: 'Email already registered!' 
            });
        }

        // Insert participant
        const [result] = await pool.query(
            `INSERT INTO participants 
            (team_name, participant_name, email, phone, language, experience, team_type) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [teamName, participantName, email, phone, language, experience, teamType]
        );

        res.status(201).json({
            success: true,
            message: 'Registration successful!',
            participantId: result.insertId,
            data: {
                teamName,
                participantName,
                email,
                language
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Registration failed. Please try again.' 
        });
    }
});

// ============================================
// 2. GET ALL PARTICIPANTS
// ============================================
app.get('/api/participants', async (req, res) => {
    try {
        const [participants] = await pool.query(
            'SELECT * FROM participants ORDER BY registration_date DESC'
        );

        res.json({
            success: true,
            count: participants.length,
            data: participants
        });

    } catch (error) {
        console.error('Error fetching participants:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch participants' 
        });
    }
});

// ============================================
// 3. GET PARTICIPANT BY ID
// ============================================
app.get('/api/participants/:id', async (req, res) => {
    try {
        const [participant] = await pool.query(
            'SELECT * FROM participants WHERE id = ?',
            [req.params.id]
        );

        if (participant.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Participant not found' 
            });
        }

        res.json({
            success: true,
            data: participant[0]
        });

    } catch (error) {
        console.error('Error fetching participant:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch participant' 
        });
    }
});

// ============================================
// 4. GET ALL ROUNDS
// ============================================
app.get('/api/rounds', async (req, res) => {
    try {
        const [rounds] = await pool.query(
            'SELECT id, round_number, title, description, language, difficulty, points, hint, time_limit FROM rounds WHERE is_active = TRUE ORDER BY round_number'
        );

        res.json({
            success: true,
            count: rounds.length,
            data: rounds
        });

    } catch (error) {
        console.error('Error fetching rounds:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch rounds' 
        });
    }
});

// ============================================
// 5. GET ROUND BY ID (with code)
// ============================================
app.get('/api/rounds/:id', async (req, res) => {
    try {
        const [round] = await pool.query(
            'SELECT * FROM rounds WHERE id = ? AND is_active = TRUE',
            [req.params.id]
        );

        if (round.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Round not found' 
            });
        }

        // Don't send correct answer to client
        const roundData = { ...round[0] };
        delete roundData.correct_answer;

        res.json({
            success: true,
            data: roundData
        });

    } catch (error) {
        console.error('Error fetching round:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch round' 
        });
    }
});

// ============================================
// 6. SUBMIT ANSWER
// ============================================
app.post('/api/submit', async (req, res) => {
    try {
        const { participantId, roundId, answer, timeTaken } = req.body;

        // Validation
        if (!participantId || !roundId || !answer) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields' 
            });
        }

        // Get round details
        const [round] = await pool.query(
            'SELECT correct_answer, points, explanation FROM rounds WHERE id = ?',
            [roundId]
        );

        if (round.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Round not found' 
            });
        }

        // Check if answer is correct (simple keyword matching)
        const correctAnswer = round[0].correct_answer.toLowerCase();
        const userAnswer = answer.toLowerCase();
        const isCorrect = userAnswer.includes(correctAnswer.substring(0, 20));

        const pointsEarned = isCorrect ? round[0].points : 0;

        // Insert submission
        await pool.query(
            `INSERT INTO submissions 
            (participant_id, round_id, answer, is_correct, points_earned, time_taken) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [participantId, roundId, answer, isCorrect, pointsEarned, timeTaken]
        );

        // Update leaderboard
        await updateLeaderboard(participantId);

        res.json({
            success: true,
            isCorrect,
            pointsEarned,
            explanation: round[0].explanation
        });

    } catch (error) {
        console.error('Submission error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to submit answer' 
        });
    }
});

// ============================================
// 7. GET LEADERBOARD
// ============================================
app.get('/api/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const language = req.query.language;

        let query = `
            SELECT 
                l.*,
                RANK() OVER (ORDER BY total_points DESC, average_time ASC) as rank_position
            FROM leaderboard l
        `;

        const params = [];

        if (language) {
            query += ' WHERE language = ?';
            params.push(language);
        }

        query += ' ORDER BY total_points DESC, average_time ASC LIMIT ?';
        params.push(limit);

        const [leaderboard] = await pool.query(query, params);

        res.json({
            success: true,
            count: leaderboard.length,
            data: leaderboard
        });

    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch leaderboard' 
        });
    }
});

// ============================================
// 8. GET STATISTICS
// ============================================
app.get('/api/stats', async (req, res) => {
    try {
        // Total participants
        const [totalParticipants] = await pool.query(
            'SELECT COUNT(*) as count FROM participants'
        );

        // Participants by language
        const [languageStats] = await pool.query(`
            SELECT 
                language, 
                COUNT(*) as count 
            FROM participants 
            GROUP BY language
        `);

        // Total submissions
        const [totalSubmissions] = await pool.query(
            'SELECT COUNT(*) as count FROM submissions'
        );

        // Correct submissions
        const [correctSubmissions] = await pool.query(
            'SELECT COUNT(*) as count FROM submissions WHERE is_correct = TRUE'
        );

        res.json({
            success: true,
            data: {
                totalParticipants: totalParticipants[0].count,
                totalSubmissions: totalSubmissions[0].count,
                correctSubmissions: correctSubmissions[0].count,
                languageDistribution: languageStats
            }
        });

    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch statistics' 
        });
    }
});

// ============================================
// 9. GET PARTICIPANT PROGRESS
// ============================================
app.get('/api/participants/:id/progress', async (req, res) => {
    try {
        const [progress] = await pool.query(`
            SELECT 
                p.id,
                p.participant_name,
                p.team_name,
                p.language,
                COUNT(s.id) as submissions_count,
                SUM(s.points_earned) as total_points,
                COUNT(CASE WHEN s.is_correct = TRUE THEN 1 END) as correct_answers,
                AVG(s.time_taken) as avg_time
            FROM participants p
            LEFT JOIN submissions s ON p.id = s.participant_id
            WHERE p.id = ?
            GROUP BY p.id
        `, [req.params.id]);

        if (progress.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Participant not found' 
            });
        }

        res.json({
            success: true,
            data: progress[0]
        });

    } catch (error) {
        console.error('Error fetching progress:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch progress' 
        });
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function updateLeaderboard(participantId) {
    try {
        await pool.query(`
            INSERT INTO leaderboard 
            (participant_id, team_name, participant_name, language, total_points, rounds_completed, average_time)
            SELECT 
                p.id,
                p.team_name,
                p.participant_name,
                p.language,
                COALESCE(SUM(s.points_earned), 0) as total_points,
                COUNT(DISTINCT s.round_id) as rounds_completed,
                COALESCE(AVG(s.time_taken), 0) as average_time
            FROM participants p
            LEFT JOIN submissions s ON p.id = s.participant_id
            WHERE p.id = ?
            GROUP BY p.id
            ON DUPLICATE KEY UPDATE
                total_points = VALUES(total_points),
                rounds_completed = VALUES(rounds_completed),
                average_time = VALUES(average_time)
        `, [participantId]);
    } catch (error) {
        console.error('Error updating leaderboard:', error);
    }
}

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: 'Endpoint not found' 
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        message: 'Something went wrong!' 
    });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`🚀 Bug Rush API running on http://localhost:${PORT}`);
    console.log(`📊 Database: ${dbConfig.database}`);
});

// Test database connection
pool.query('SELECT 1')
    .then(() => console.log('✅ Database connected successfully'))
    .catch(err => console.error('❌ Database connection failed:', err));

module.exports = app;