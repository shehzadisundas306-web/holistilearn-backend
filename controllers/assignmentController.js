// backend/controllers/assignmentController.js
import mongoose from 'mongoose';
import Assignment from '../models/Assignment.js';
import AssignmentSubmission from '../models/AssignmentSubmission.js';
import Class from '../models/Class.js';
import User from '../models/userModel.js';
import NotificationService from '../services/notificationService.js';

// Create assignment
export const createAssignment = async (req, res) => {
  try {
    const { classId, title, description, dueDate, totalPoints, attachment } = req.body;
    const teacherId = req.userId;
    const io = req.app.locals.io;

    // ==================== VALIDATION 1: Required Fields ====================
    const missingFields = [];
    if (!classId) missingFields.push('classId');
    if (!title) missingFields.push('title');
    if (!title || title.trim() === '') missingFields.push('title (cannot be empty)');
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Missing required fields: ${missingFields.join(', ')}` 
      });
    }

    // ==================== VALIDATION 2: Title Length ====================
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assignment title must be at least 3 characters long' 
      });
    }
    
    if (trimmedTitle.length > 200) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assignment title cannot exceed 200 characters' 
      });
    }

    // ==================== VALIDATION 3: Description (if provided) ====================
    let trimmedDescription = '';
    if (description) {
      trimmedDescription = description.trim();
      if (trimmedDescription.length > 5000) {
        return res.status(400).json({ 
          success: false, 
          message: 'Assignment description cannot exceed 5000 characters' 
        });
      }
    }

    // ==================== VALIDATION 4: Class Ownership ====================
    const classData = await Class.findOne({ _id: classId, teacherId });
    if (!classData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized: You do not own this class or the class does not exist' 
      });
    }

    // ==================== VALIDATION 5: Due Date ====================
    let validatedDueDate = null;
    if (dueDate) {
      const parsedDueDate = new Date(dueDate);
      
      // Check if date is valid
      if (isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid due date format. Please provide a valid date.' 
        });
      }
      
      // Check if due date is in the past
      const now = new Date();
      if (parsedDueDate < now) {
        return res.status(400).json({ 
          success: false, 
          message: 'Due date cannot be in the past. Please select a future date.' 
        });
      }
      
      // Check if due date is too far in the future (max 1 year)
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
      if (parsedDueDate > oneYearFromNow) {
        return res.status(400).json({ 
          success: false, 
          message: 'Due date cannot be more than 1 year from now' 
        });
      }
      
      validatedDueDate = parsedDueDate;
    }

    // ==================== VALIDATION 6: Total Points ====================
    let validatedTotalPoints = 100; // Default
    
    if (totalPoints !== undefined && totalPoints !== null) {
      const points = Number(totalPoints);
      
      // Check if it's a valid number
      if (isNaN(points)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Total points must be a valid number' 
        });
      }
      
      // Check if it's an integer
      if (!Number.isInteger(points)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Total points must be a whole number' 
        });
      }
      
      // Check range
      if (points < 1) {
        return res.status(400).json({ 
          success: false, 
          message: 'Total points must be at least 1' 
        });
      }
      
      if (points > 1000) {
        return res.status(400).json({ 
          success: false, 
          message: 'Total points cannot exceed 1000' 
        });
      }
      
      validatedTotalPoints = points;
    }

    // ==================== VALIDATION 7: Attachment ====================
    let validatedAttachment = null;
    if (attachment) {
      // Check if attachment has required fields
      if (!attachment.url || typeof attachment.url !== 'string') {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid attachment: URL is required' 
        });
      }
      
      // Validate URL format (basic check)
      const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
      if (!urlPattern.test(attachment.url)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid attachment URL format' 
        });
      }
      
      // Check file name length
      if (attachment.fileName && attachment.fileName.length > 255) {
        return res.status(400).json({ 
          success: false, 
          message: 'File name is too long (max 255 characters)' 
        });
      }
      
      // Optional: Validate file type
      if (attachment.fileName) {
        const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.zip'];
        const fileExt = attachment.fileName.toLowerCase().substring(attachment.fileName.lastIndexOf('.'));
        if (fileExt && !allowedExtensions.includes(fileExt)) {
          console.warn(`⚠️ Unusual file type uploaded: ${fileExt}`);
          // Don't block, just warn
        }
      }
      
      validatedAttachment = {
        url: attachment.url,
        fileName: attachment.fileName || 'attachment',
        fileType: attachment.fileType || 'application/octet-stream',
        fileSize: attachment.fileSize || 0
      };
    }

    // ==================== CREATE ASSIGNMENT ====================
    const assignment = await Assignment.create({
      classId,
      teacherId,
      title: trimmedTitle,
      description: trimmedDescription || '',
      dueDate: validatedDueDate,
      totalPoints: validatedTotalPoints,
      attachment: validatedAttachment,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // ==================== SEND NOTIFICATIONS ====================
    const notificationService = new NotificationService(io);
    const studentIds = classData.students
      .map(s => s.studentId)
      .filter(id => id && id.toString());
    
    if (studentIds.length > 0) {
      const dueDateStr = validatedDueDate 
        ? validatedDueDate.toLocaleDateString() 
        : 'No due date';
      
      await notificationService.sendToMultipleUsers(studentIds, {
        type: 'assignment',
        title: '📝 New Assignment!',
        message: `"${trimmedTitle}" is now available. Due: ${dueDateStr} | Points: ${validatedTotalPoints}`,
        link: `/student/classes/${classId}/assignments`,
        icon: '📝',
        color: '#10b981',
        priority: 'high',
        data: {
          assignmentId: assignment._id,
          assignmentTitle: trimmedTitle,
          dueDate: validatedDueDate,
          totalPoints: validatedTotalPoints,
          hasAttachment: !!validatedAttachment
        }
      });
    }

    // ==================== RETURN SUCCESS ====================
    res.status(201).json({ 
      success: true, 
      message: 'Assignment created successfully',
      data: {
        _id: assignment._id,
        title: assignment.title,
        description: assignment.description,
        dueDate: assignment.dueDate,
        totalPoints: assignment.totalPoints,
        attachment: assignment.attachment,
        createdAt: assignment.createdAt
      }
    });
    
  } catch (error) {
    console.error('Create assignment error:', error);
    
    // Handle duplicate assignment title (if you have unique constraint)
    if (error.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        message: 'An assignment with this title already exists for this class' 
      });
    }
    
    // Handle validation errors from mongoose
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        success: false, 
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create assignment. Please try again.' 
    });
  }
};

// Get all assignments for a class (teacher view)
export const getClassAssignments = async (req, res) => {
  try {
    const { classId } = req.params;
    const teacherId = req.userId;

    // Verify teacher owns the class
    const classData = await Class.findOne({ _id: classId, teacherId });
    if (!classData) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const assignments = await Assignment.find({ classId, isActive: true })
      .sort({ createdAt: -1 });

    // Get submission counts for each assignment
    const assignmentsWithStats = await Promise.all(assignments.map(async (assignment) => {
      const submissions = await AssignmentSubmission.countDocuments({ assignmentId: assignment._id });
      const graded = await AssignmentSubmission.countDocuments({ 
        assignmentId: assignment._id, 
        status: 'graded' 
      });
      
      return {
        ...assignment.toObject(),
        submissionsCount: submissions,
        gradedCount: graded,
        pendingCount: submissions - graded,
        totalStudents: classData.students?.length || 0
      };
    }));

    res.json({ success: true, data: assignmentsWithStats });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({ success: false, message: 'Failed to load assignments' });
  }
};

// Get assignment submissions (teacher view)
export const getAssignmentSubmissions = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const teacherId = req.userId;

    const assignment = await Assignment.findOne({ _id: assignmentId, teacherId });
    if (!assignment) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const submissions = await AssignmentSubmission.find({ assignmentId })
      .populate('studentId', 'name username email profile.avatar');

    res.json({ success: true, data: submissions });
  } catch (error) {
    console.error('Get submissions error:', error);
    res.status(500).json({ success: false, message: 'Failed to load submissions' });
  }
};

// Grade submission
export const gradeSubmission = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { marks, feedback } = req.body;
    const teacherId = req.userId;
    const io = req.app.locals.io;

    const submission = await AssignmentSubmission.findById(submissionId)
      .populate('assignmentId');

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    // Verify teacher owns the assignment
    const assignment = await Assignment.findOne({ 
      _id: submission.assignmentId._id, 
      teacherId 
    });
    
    if (!assignment) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    submission.marks = marks;
    submission.feedback = feedback;
    submission.status = 'graded';
    await submission.save();

    // Notify student
    const notificationService = new NotificationService(io);
    await notificationService.sendToUser(submission.studentId, {
      type: 'graded',
      title: '📊 Assignment Graded!',
      message: `Your assignment "${assignment.title}" has been graded. Score: ${marks}/${assignment.totalPoints}`,
      link: `/student/classes/${assignment.classId}/assignments`,
      icon: '📊',
      color: '#f59e0b',
      priority: 'high',
      data: {
        assignmentId: assignment._id,
        marks,
        totalPoints: assignment.totalPoints
      }
    });

    res.json({ success: true, data: submission });
  } catch (error) {
    console.error('Grade submission error:', error);
    res.status(500).json({ success: false, message: 'Failed to grade submission' });
  }
};

// Delete assignment
export const deleteAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const teacherId = req.userId;

    const assignment = await Assignment.findOne({ _id: assignmentId, teacherId });
    if (!assignment) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Soft delete
    assignment.isActive = false;
    await assignment.save();

    res.json({ success: true, message: 'Assignment deleted successfully' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete assignment' });
  }
};

// ==================== STUDENT CONTROLLERS ====================

// Get assignments for student
export const getStudentAssignments = async (req, res) => {
  try {
    const { classId } = req.params;
    const studentId = req.userId;

    // Verify enrollment
    const classData = await Class.findOne({ 
      _id: classId, 
      'students.studentId': studentId,
      isActive: true 
    });

    if (!classData) {
      return res.status(403).json({ success: false, message: 'You are not enrolled in this class' });
    }

    const assignments = await Assignment.find({ 
      classId, 
      isActive: true 
    }).sort({ dueDate: 1, createdAt: -1 });

    // Get submission status for each assignment
    const assignmentsWithStatus = await Promise.all(assignments.map(async (assignment) => {
      const submission = await AssignmentSubmission.findOne({ 
        assignmentId: assignment._id, 
        studentId 
      });
      
      return {
        ...assignment.toObject(),
        submitted: !!submission,
        submission: submission || null,
        isLate: submission?.isLate || false,
        isGraded: submission?.status === 'graded'
      };
    }));

    res.json({ success: true, data: assignmentsWithStatus });
  } catch (error) {
    console.error('Get student assignments error:', error);
    res.status(500).json({ success: false, message: 'Failed to load assignments' });
  }
};

// Submit assignment
export const submitAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { submissionFile } = req.body;
    const studentId = req.userId;
    const io = req.app.locals.io;

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    // Check if already submitted
    const existingSubmission = await AssignmentSubmission.findOne({ 
      assignmentId, 
      studentId 
    });

    if (existingSubmission) {
      return res.status(400).json({ success: false, message: 'You have already submitted this assignment' });
    }

    const isLate = new Date() > new Date(assignment.dueDate);

    const submission = await AssignmentSubmission.create({
      assignmentId,
      studentId,
      submissionFile,
      isLate,
      status: isLate ? 'late' : 'submitted'
    });

    // Notify teacher
    const notificationService = new NotificationService(io);
    const student = await User.findById(studentId).select('name username');
    
    await notificationService.sendToTeacher(assignment.classId, {
      type: 'submission',
      title: '📎 New Assignment Submission!',
      message: `${student?.name || student?.username} submitted "${assignment.title}"${isLate ? ' (LATE)' : ''}`,
      link: `/teacher/dashboard/assignments/${assignment._id}/submissions`,
      icon: '📎',
      color: '#10b981',
      priority: 'high',
      data: {
        assignmentId: assignment._id,
        studentId,
        studentName: student?.name,
        isLate
      }
    });

    res.json({ success: true, data: submission });
  } catch (error) {
    console.error('Submit assignment error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit assignment' });
  }
};

// Get student's submission for an assignment
export const getStudentSubmission = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const studentId = req.userId;

    const submission = await AssignmentSubmission.findOne({ 
      assignmentId, 
      studentId 
    });

    res.json({ success: true, data: submission });
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({ success: false, message: 'Failed to load submission' });
  }
};