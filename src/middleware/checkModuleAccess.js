const Instructor = require('../models/Instructor');

// Usage: checkModuleAccess('courses')
function checkModuleAccess(moduleName) {
  return async (req, res, next) => {
    const instructorId = req.user._id; // assuming user is authenticated
    const instructor = await Instructor.findById(instructorId);
    if (!instructor) return res.status(404).send('Instructor not found');
    const module =
      instructor.modules.find(mod => mod.name === moduleName);
    if (!module || module.isDisable) {
      return res.status(403).send('Access to this module is disabled');
    }
    next();
  };
}

module.exports = checkModuleAccess;