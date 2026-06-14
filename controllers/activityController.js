import Activity from '../models/Activity.js';
export const getRecentActivities = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { limit = 10, skip = 0 } = req.query;

    const activity = await Activity.findOne({ studentId });

    if (!activity) {
      return res.json({
        success: true,
        data: {
          activities: [],
          total: 0,
          unreadCount: 0
        }
      });
    }

    // Sort activities by timestamp (newest first)
    const sortedActivities = [...activity.activities].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    //  FIX: Apply pagination correctly
    const paginatedActivities = sortedActivities.slice(
      parseInt(skip), 
      parseInt(skip) + parseInt(limit)
    );

    const recentActivities = paginatedActivities.map(act => ({
      id: act._id,
      text: act.description || act.title,
      title: act.title,
      description: act.description,
      time: act.timestamp,
      type: act.type,
      icon: act.icon,
      color: act.color,
      metadata: act.metadata,
      importance: act.importance,
      isRead: act.isRead
    }));

    res.json({
      success: true,
      data: {
        activities: recentActivities,
        total: sortedActivities.length,
        unreadCount: sortedActivities.filter(a => !a.isRead).length
      }
    });

  } catch (error) {
    console.error('Get recent activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activities',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// @desc    Mark activity as read
// @route   PUT /api/activity/:id/read
// @access  Private (Student)
export const markActivityAsRead = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { id } = req.params;

    const activity = await Activity.findOne({ studentId });

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found'
      });
    }

    const activityItem = activity.activities.id(id);
    if (!activityItem) {
      return res.status(404).json({
        success: false,
        message: 'Activity item not found'
      });
    }

    activityItem.isRead = true;
    await activity.save();

    res.json({
      success: true,
      message: 'Activity marked as read'
    });

  } catch (error) {
    console.error('Mark activity read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking activity as read'
    });
  }
};

export const deleteActivity = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { id } = req.params;

    const result = await Activity.updateOne(
      { studentId },
      { $pull: { activities: { _id: id } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found'
      });
    }

    res.json({
      success: true,
      message: 'Activity deleted successfully'
    });

  } catch (error) {
    console.error('Delete activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting activity'
    });
  }
};

//  FIXED: Bulk delete activities
// @desc    Delete multiple activities
// @route   DELETE /api/activity/bulk-delete
// @access  Private (Student)
export const bulkDeleteActivities = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { activityIds } = req.body;

    if (!activityIds || !Array.isArray(activityIds) || activityIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No activity IDs provided'
      });
    }

    const activity = await Activity.findOne({ studentId });

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity record not found'
      });
    }

    // Filter out the activities to delete
    const originalLength = activity.activities.length;
    activity.activities = activity.activities.filter(
      act => !activityIds.includes(act._id.toString())
    );
    
    const deletedCount = originalLength - activity.activities.length;
    // await activity.save();
    await Activity.updateOne(
  { studentId },
  {
    $pull: {
      activities: { _id: { $in: activityIds } }
    }
  }
);

    res.json({
      success: true,
      message: `${deletedCount} activities deleted successfully`,
      data: {
        deletedCount: deletedCount,
        remainingCount: activity.activities.length
      }
    });

  } catch (error) {
    console.error('Bulk delete activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting activities',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};

// ✅ FIXED: Clear all activities
// @desc    Clear all activities for a student
// @route   DELETE /api/activity/clear-all
// @access  Private (Student)
export const clearAllActivities = async (req, res) => {
  try {
    const studentId = req.user.id;

    const activity = await Activity.findOne({ studentId });

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity record not found'
      });
    }

    // Clear all activities
    const clearedCount = activity.activities.length;
    activity.activities = [];
    // await activity.save();
    await Activity.updateOne(
  { studentId },
  { $set: { activities: [] } }
);

    res.json({
      success: true,
      message: 'All activities cleared successfully',
      data: {
        clearedCount: clearedCount
      }
    });

  } catch (error) {
    console.error('Clear all activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Error clearing activities',
      error: process.env.NODE_ENV === 'development' ? error.message : {}
    });
  }
};
