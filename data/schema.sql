-- schema.sql
-- WebRO Database Schema for Neon.tech (PostgreSQL)

-- 1. Tabla de Cuentas
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,
    gm BOOLEAN DEFAULT FALSE
);

-- 2. Tabla de Personajes
CREATE TABLE IF NOT EXISTS characters (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(12) UNIQUE NOT NULL,
    gender VARCHAR(1) NOT NULL,
    hair INTEGER DEFAULT 1,
    hair_color INTEGER DEFAULT 0,
    job VARCHAR(30) DEFAULT 'Novice',
    base_level INTEGER DEFAULT 1,
    job_level INTEGER DEFAULT 1,
    base_exp INTEGER DEFAULT 0,
    job_exp INTEGER DEFAULT 0,
    hp INTEGER DEFAULT 100,
    max_hp INTEGER DEFAULT 100,
    sp INTEGER DEFAULT 30,
    max_sp INTEGER DEFAULT 30,
    str INTEGER DEFAULT 1,
    agi INTEGER DEFAULT 1,
    vit INTEGER DEFAULT 1,
    int_stat INTEGER DEFAULT 1,
    dex INTEGER DEFAULT 1,
    luk INTEGER DEFAULT 1,
    stat_points INTEGER DEFAULT 0,
    skill_points INTEGER DEFAULT 0,
    map_name VARCHAR(50) DEFAULT 'prontera',
    x INTEGER DEFAULT 15,
    y INTEGER DEFAULT 15,
    inventory JSONB DEFAULT '[]'::jsonb,
    equipment JSONB DEFAULT '{"weapon": null, "headgear": null}'::jsonb,
    skills JSONB DEFAULT '{"double_strafe": 0, "bash": 0, "fire_bolt": 0, "heal": 0}'::jsonb
);

-- Insertar cuentas demo iniciales si no existen
INSERT INTO accounts (username, password, gm) 
VALUES ('admin', 'admin', true) 
ON CONFLICT (username) DO NOTHING;

INSERT INTO accounts (username, password, gm) 
VALUES ('user', 'user', false) 
ON CONFLICT (username) DO NOTHING;
