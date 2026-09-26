-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Aug 18, 2026 at 08:31 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `clinic_appointment_system`
--

-- --------------------------------------------------------

--
-- Table structure for table `collection_appointments`
--

CREATE TABLE `collection_appointments` (
  `id` int(10) UNSIGNED NOT NULL,
  `payload` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `collection_appointments`
--

INSERT INTO `collection_appointments` (`id`, `payload`, `created_at`, `updated_at`) VALUES
(8, '{\"patientName\":\"Zareef\",\"patientEmail\":\"zareef@gmail.com\",\"patientPhone\":\"01997282589\",\"date\":\"2027-03-12\",\"time\":\"14:30\",\"doctorId\":1,\"doctorName\":\"Dr. Muhammad Irfan\",\"doctorDepartment\":\"Cardiology\",\"status\":\"Scheduled\",\"createdAt\":\"2026-08-17T12:36:22+00:00\"}', '2026-08-17 12:36:22', '2026-08-17 12:36:22');

-- --------------------------------------------------------

--
-- Table structure for table `collection_leaves`
--

CREATE TABLE `collection_leaves` (
  `id` int(10) UNSIGNED NOT NULL,
  `payload` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `collection_leaves`
--

INSERT INTO `collection_leaves` (`id`, `payload`, `created_at`, `updated_at`) VALUES
(1, '{\"doctorId\":1,\"doctorName\":\"Dr. Muhammad Irfan\",\"startDate\":\"2026-08-27\",\"endDate\":\"2026-09-01\",\"reason\":\"Annual Leave ( Family Holiday Issue)\",\"status\":\"Approved\",\"createdAt\":\"2026-08-18T03:15:10+00:00\",\"reviewedBy\":\"Admin User\",\"reviewedAt\":\"2026-08-18T03:15:50+00:00\",\"updatedAt\":\"2026-08-18T03:15:50+00:00\"}', '2026-08-18 03:15:10', '2026-08-18 03:15:50'),
(2, '{\"doctorId\":2,\"doctorName\":\"Dr. Afif Wahdi\",\"startDate\":\"2026-08-23\",\"endDate\":\"2026-08-27\",\"reason\":\"Rest Leave\",\"status\":\"Rejected\",\"createdAt\":\"2026-08-18T04:39:18+00:00\",\"reviewedBy\":\"Admin User\",\"reviewedAt\":\"2026-08-18T04:39:43+00:00\",\"updatedAt\":\"2026-08-18T04:39:43+00:00\"}', '2026-08-18 04:39:18', '2026-08-18 04:39:43'),
(3, '{\"doctorId\":2,\"doctorName\":\"Dr. Afif Wahdi\",\"startDate\":\"2027-08-23\",\"endDate\":\"2027-08-24\",\"reason\":\"Marriage Day\",\"status\":\"Approved\",\"createdAt\":\"2026-08-18T06:18:57+00:00\",\"reviewedBy\":\"Admin User\",\"reviewedAt\":\"2026-08-18T06:19:25+00:00\",\"updatedAt\":\"2026-08-18T06:19:25+00:00\"}', '2026-08-18 06:18:57', '2026-08-18 06:19:25');

-- --------------------------------------------------------

--
-- Table structure for table `collection_messages`
--

CREATE TABLE `collection_messages` (
  `id` int(10) UNSIGNED NOT NULL,
  `payload` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `collection_messages`
--

INSERT INTO `collection_messages` (`id`, `payload`, `created_at`, `updated_at`) VALUES
(1, '{\"senderId\": \"1\", \"senderName\": \"Dr. Muhammad Irfan\", \"groupId\": \"doctor\", \"content\": \"hello?\", \"timestamp\": \"2026-07-20T08:07:07+00:00\", \"read\": false, \"createdAt\": \"2026-07-20T08:07:07+00:00\", \"recipientId\": null}', '2026-07-23 02:13:50', '2026-08-17 12:47:10'),
(2, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":null,\"note\":null},\"timestamp\":\"2026-07-20T08:09:50+00:00\",\"read\":false,\"createdAt\":\"2026-07-20T08:09:50+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(3, '{\"senderId\": \"1\", \"senderName\": \"Dr. Muhammad Irfan\", \"groupId\": \"doctor\", \"content\": \"hi\", \"timestamp\": \"2026-07-20T08:20:29+00:00\", \"read\": false, \"createdAt\": \"2026-07-20T08:20:29+00:00\", \"recipientId\": null}', '2026-07-23 02:13:50', '2026-08-17 12:47:10'),
(4, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":null,\"note\":null},\"timestamp\":\"2026-07-20T08:21:13+00:00\",\"read\":false,\"createdAt\":\"2026-07-20T08:21:13+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(5, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":null,\"note\":null},\"timestamp\":\"2026-07-23T01:53:03+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T01:53:03+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(6, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Aizul Eirfan in room ICU-03. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":1,\"patientName\":\"Aizul Eirfan\",\"roomNumber\":\"ICU-03\",\"note\":\"Cardiac arrest suspected\"},\"timestamp\":\"2026-07-23T01:56:59+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T01:56:59+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(7, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Fatimah in room Ward-5B. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":2,\"patientName\":\"Fatimah\",\"roomNumber\":\"Ward-5B\",\"note\":\"Sudden collapse\"},\"timestamp\":\"2026-07-23T02:00:40+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T02:00:40+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(8, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Aizul Eirfan. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":1,\"patientName\":\"Aizul Eirfan\",\"roomNumber\":null,\"note\":null},\"timestamp\":\"2026-07-23T02:02:28+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T02:02:28+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(9, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency in room OPERATION THEATHER. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":null,\"patientName\":null,\"roomNumber\":\"OPERATION THEATHER\",\"note\":null},\"timestamp\":\"2026-07-23T02:02:38+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T02:02:38+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(10, '{\"senderId\":1,\"senderName\":\"Dr. Muhammad Irfan\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Aizul Eirfan in room ICU-01. Nurse Dr. Muhammad Irfan requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":1,\"patientName\":\"Aizul Eirfan\",\"roomNumber\":\"ICU-01\",\"note\":\"Doctor-triggered emergency test\"},\"timestamp\":\"2026-07-23T02:04:01+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T02:04:01+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(11, '{\"senderId\":1,\"senderName\":\"Dr. Muhammad Irfan\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Aizul Eirfan in room ICU-02. Doctor Dr. Muhammad Irfan requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":1,\"patientName\":\"Aizul Eirfan\",\"roomNumber\":\"ICU-02\",\"note\":\"Doctor wording check\"},\"timestamp\":\"2026-07-23T02:04:12+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T02:04:12+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(12, '{\"senderId\": \"1\", \"senderName\": \"Dr. Muhammad Irfan\", \"recipientId\": \"null\", \"groupId\": \"all\", \"content\": \"CODE BLUE emergency for Aizul Eirfan in room OPERATION THEATHER. Doctor Dr. Muhammad Irfan requires immediate assistance.\", \"type\": \"code-blue\", \"metadata\": {\"patientId\": 1, \"patientName\": \"Aizul Eirfan\", \"roomNumber\": \"OPERATION THEATHER\", \"note\": \"Urgent assistance for patient ID 1\"}, \"timestamp\": \"2026-07-23T02:04:35+00:00\", \"read\": false, \"createdAt\": \"2026-07-23T02:04:35+00:00\"}', '2026-07-23 02:13:50', '2026-08-17 12:47:10'),
(13, '{\"senderId\": \"1\", \"senderName\": \"Dr. Muhammad Irfan\", \"recipientId\": \"null\", \"groupId\": \"all\", \"content\": \"CODE BLUE emergency for Aizul Eirfan in room Ward 5A. Doctor Dr. Muhammad Irfan requires immediate assistance.\", \"type\": \"code-blue\", \"metadata\": {\"patientId\": 1, \"patientName\": \"Aizul Eirfan\", \"roomNumber\": \"Ward 5A\", \"note\": \"Bring Electric Heart Berlin\"}, \"timestamp\": \"2026-07-23T02:05:06+00:00\", \"read\": false, \"createdAt\": \"2026-07-23T02:05:06+00:00\"}', '2026-07-23 02:13:50', '2026-08-17 12:47:10'),
(14, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Aizul Eirfan in room WARD-7. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":1,\"patientName\":\"Aizul Eirfan\",\"roomNumber\":\"WARD-7\",\"note\":\"oxygen drop\"},\"timestamp\":\"2026-07-23T02:11:44+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T02:11:44+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(15, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Aizul Eirfan in room WARD-8. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":1,\"patientName\":\"Aizul Eirfan\",\"roomNumber\":\"WARD-8\",\"note\":\"bp drop\"},\"timestamp\":\"2026-07-23T02:11:51+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T02:11:51+00:00\"}', '2026-07-23 02:13:50', '2026-07-23 02:13:50'),
(16, '{\"senderId\":3,\"senderName\":\"Nurse Raj\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Aizul Eirfan in room ER-03. Nurse Nurse Raj requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":1,\"patientName\":\"Aizul Eirfan\",\"roomNumber\":\"ER-03\",\"note\":\"desaturation observed\"},\"timestamp\":\"2026-07-23T02:20:49+00:00\",\"read\":false,\"createdAt\":\"2026-07-23T02:20:49+00:00\"}', '2026-07-23 02:20:49', '2026-07-23 02:20:49'),
(17, '{\"senderId\": \"1\", \"senderName\": \"Dr. Muhammad Irfan\", \"recipientId\": \"null\", \"groupId\": \"all\", \"content\": \"CODE BLUE emergency for Aizul Eirfan. Doctor Dr. Muhammad Irfan requires immediate assistance.\", \"type\": \"code-blue\", \"metadata\": {\"patientId\": 1, \"patientName\": \"Aizul Eirfan\", \"roomNumber\": null, \"note\": \"Urgent assistance for patient ID 1\"}, \"timestamp\": \"2026-07-23T02:44:47+00:00\", \"read\": false, \"createdAt\": \"2026-07-23T02:44:47+00:00\"}', '2026-07-23 02:44:47', '2026-08-17 12:47:10'),
(18, '{\"senderId\": \"1\", \"senderName\": \"Dr. Muhammad Irfan\", \"recipientId\": \"null\", \"groupId\": \"all\", \"content\": \"CODE BLUE emergency for Aizul Eirfan in room Dewan Besar. Doctor Dr. Muhammad Irfan requires immediate assistance.\", \"type\": \"code-blue\", \"metadata\": {\"patientId\": 1, \"patientName\": \"Aizul Eirfan\", \"roomNumber\": \"Dewan Besar\", \"note\": \"Mati\"}, \"timestamp\": \"2026-07-24T09:07:27+00:00\", \"read\": false, \"createdAt\": \"2026-07-24T09:07:27+00:00\"}', '2026-07-24 09:07:27', '2026-08-17 12:47:10'),
(19, '{\"senderId\": \"1\", \"senderName\": \"Dr. Muhammad Irfan\", \"recipientId\": \"null\", \"groupId\": \"all\", \"content\": \"CODE BLUE emergency for Aizul Eirfan. Doctor Dr. Muhammad Irfan requires immediate assistance.\", \"type\": \"code-blue\", \"metadata\": {\"patientId\": 1, \"patientName\": \"Aizul Eirfan\", \"roomNumber\": null, \"note\": \"Urgent assistance for patient ID 1\"}, \"timestamp\": \"2026-07-26T04:59:11+00:00\", \"read\": false, \"createdAt\": \"2026-07-26T04:59:11+00:00\"}', '2026-07-26 04:59:11', '2026-08-17 12:47:10'),
(20, '{\"senderId\":1,\"senderName\":\"Dr. Muhammad Irfan\",\"groupId\":\"doctor\",\"content\":\"hi\",\"timestamp\":\"2026-08-17T12:45:13+00:00\",\"read\":false,\"createdAt\":\"2026-08-17T12:45:13+00:00\"}', '2026-08-17 12:45:13', '2026-08-17 12:45:13'),
(21, '{\"senderId\":1,\"senderName\":\"Dr. Muhammad Irfan\",\"recipientId\":null,\"groupId\":\"all\",\"content\":\"CODE BLUE emergency for Aizul Eirfan in room Ward 5A. Doctor Dr. Muhammad Irfan requires immediate assistance.\",\"type\":\"code-blue\",\"metadata\":{\"patientId\":1,\"patientName\":\"Aizul Eirfan\",\"roomNumber\":\"Ward 5A\",\"note\":\"Urgent assistance for patient ID 1\"},\"timestamp\":\"2026-08-18T05:29:35+00:00\",\"read\":false,\"createdAt\":\"2026-08-18T05:29:35+00:00\"}', '2026-08-18 05:29:35', '2026-08-18 05:29:35');

-- --------------------------------------------------------

--
-- Table structure for table `collection_organ_donors`
--

CREATE TABLE `collection_organ_donors` (
  `id` int(10) UNSIGNED NOT NULL,
  `payload` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `collection_organ_donors`
--

INSERT INTO `collection_organ_donors` (`id`, `payload`, `created_at`, `updated_at`) VALUES
(2, '{\"name\":\"Afif Wahdi\",\"organType\":\"Kidney\",\"tribute\":\"Nope. All the best!\",\"createdAt\":\"2026-08-18T02:12:34+00:00\"}', '2026-08-18 02:12:34', '2026-08-18 02:12:34'),
(3, '{\"name\":\"Zareef Rahimi\",\"organType\":\"Liver\",\"tribute\":\"Love Ya.\",\"createdAt\":\"2026-08-18T02:29:14+00:00\"}', '2026-08-18 02:29:14', '2026-08-18 02:29:14'),
(4, '{\"name\":\"Iskandar\",\"organType\":\"Kidney\",\"tribute\":\".\",\"createdAt\":\"2026-08-18T06:20:16+00:00\"}', '2026-08-18 06:20:16', '2026-08-18 06:20:16');

-- --------------------------------------------------------

--
-- Table structure for table `collection_patients`
--

CREATE TABLE `collection_patients` (
  `id` int(10) UNSIGNED NOT NULL,
  `payload` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `collection_patients`
--

INSERT INTO `collection_patients` (`id`, `payload`, `created_at`, `updated_at`) VALUES
(1, '{\"name\": \"Aizul Eirfan\", \"patientCode\": \"AIZ-008\", \"age\": 17, \"gender\": \"Male\", \"bloodType\": \"O+\", \"phone\": \"0145578922\", \"email\": \"aizuleirfan@proton.me\", \"address\": \"Wing A\", \"diagnosis\": \"Heart Attack During Jog\", \"sicknessCategory\": \"Cardiology\", \"severity\": \"Critical\", \"admittedDate\": \"2026-07-20\", \"admittedBy\": 3, \"assignedDoctor\": 1, \"requiredDoctorDepartment\": \"Cardiology\", \"assignedStaff\": 3, \"vitals\": {\"temperature\": null, \"bloodPressure\": \"129/98\", \"heartRate\": null, \"respiratoryRate\": null, \"lastUpdated\": \"2026-07-20T08:09:42+00:00\"}, \"notes\": \"\", \"createdAt\": \"2026-07-20T08:09:18+00:00\", \"updatedAt\": \"2026-07-20T08:09:42+00:00\"}', '2026-07-23 02:13:50', '2026-08-17 12:47:10'),
(4, '{\"name\":\"Zareef\",\"patientCode\":\"ZACK-002\",\"age\":24,\"gender\":\"Transgender\",\"bloodType\":\"O-\",\"phone\":\"01456788688\",\"email\":\"zareefouch@gmail.com\",\"address\":\"Wing B ( Spec )\",\"diagnosis\":\"Obesity ( Heart Failure )\",\"sicknessCategory\":\"Cardiology\",\"severity\":\"Mild\",\"admittedDate\":\"2026-07-26\",\"admittedBy\":3,\"assignedDoctor\":1,\"requiredDoctorDepartment\":\"Cardiology\",\"assignedStaff\":3,\"vitals\":{\"temperature\":null,\"bloodPressure\":null,\"heartRate\":null,\"respiratoryRate\":null,\"lastUpdated\":\"2026-07-26T05:10:56+00:00\"},\"notes\":\"\",\"createdAt\":\"2026-07-26T05:10:56+00:00\"}', '2026-07-26 05:10:56', '2026-07-26 05:10:56');

-- --------------------------------------------------------

--
-- Table structure for table `collection_users`
--

CREATE TABLE `collection_users` (
  `id` int(10) UNSIGNED NOT NULL,
  `payload` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `collection_users`
--

INSERT INTO `collection_users` (`id`, `payload`, `created_at`, `updated_at`) VALUES
(1, '{\"username\": \"muhammad.irfan\", \"password\": \"password123\", \"name\": \"Dr. Muhammad Irfan\", \"role\": \"doctor\", \"email\": \"doctor1@hospital.com\", \"department\": \"Cardiology\", \"createdAt\": \"2026-07-17T01:48:10+00:00\"}', '2026-07-23 02:21:05', '2026-08-17 12:48:31'),
(2, '{\"username\": \"afif.wahdi\", \"password\": \"password123\", \"name\": \"Dr. Afif Wahdi\", \"role\": \"doctor\", \"email\": \"doctor2@hospital.com\", \"department\": \"Psychiatry\", \"createdAt\": \"2026-07-17T01:48:10+00:00\"}', '2026-07-23 02:21:05', '2026-08-18 01:42:44'),
(3, '{\"username\":\"staff1\",\"password\":\"password123\",\"name\":\"Nurse Raj\",\"role\":\"staff\",\"email\":\"staff1@hospital.com\",\"department\":\"General Ward\",\"createdAt\":\"2026-07-17T01:48:10+00:00\"}', '2026-07-23 02:21:05', '2026-07-23 02:21:05'),
(4, '{\"username\":\"admin\",\"password\":\"password123\",\"name\":\"Admin User\",\"role\":\"admin\",\"email\":\"admin@hospital.com\",\"department\":null,\"createdAt\":\"2026-07-17T01:48:10+00:00\"}', '2026-07-23 02:21:05', '2026-07-23 02:21:05'),
(5, '{\"username\":\"patient1\",\"password\":\"password123\",\"name\":\"Ali\",\"role\":\"patient\",\"email\":\"patient1@hospital.com\",\"department\":null,\"createdAt\":\"2026-07-17T01:48:10+00:00\"}', '2026-07-23 02:21:05', '2026-07-23 02:21:05'),
(9, '{\"username\": \"aizul.eirfan\", \"password\": \"password123\", \"name\": \"Dr. Aizul Eirfan\", \"role\": \"doctor\", \"email\": \"doctor3@hospital.com\", \"department\": \"Neuro-Oftalmology\", \"createdAt\": \"2026-07-23T01:31:36+00:00\"}', '2026-07-23 02:21:05', '2026-08-17 12:48:31'),
(10, '{\"username\":\"nurse1\",\"password\":\"password123\",\"name\":\"Nurse Sarah\",\"role\":\"staff\",\"email\":\"nurse1@hospital.com\",\"department\":\"Emergency\",\"createdAt\":\"2026-07-23T02:21:05+00:00\"}', '2026-07-23 02:21:05', '2026-07-23 02:21:05');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `collection_appointments`
--
ALTER TABLE `collection_appointments`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `collection_leaves`
--
ALTER TABLE `collection_leaves`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `collection_messages`
--
ALTER TABLE `collection_messages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `collection_organ_donors`
--
ALTER TABLE `collection_organ_donors`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `collection_patients`
--
ALTER TABLE `collection_patients`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `collection_users`
--
ALTER TABLE `collection_users`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `collection_appointments`
--
ALTER TABLE `collection_appointments`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `collection_leaves`
--
ALTER TABLE `collection_leaves`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `collection_messages`
--
ALTER TABLE `collection_messages`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=22;

--
-- AUTO_INCREMENT for table `collection_organ_donors`
--
ALTER TABLE `collection_organ_donors`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `collection_patients`
--
ALTER TABLE `collection_patients`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `collection_users`
--
ALTER TABLE `collection_users`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
