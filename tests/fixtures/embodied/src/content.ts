export const pageTitle = '具身智能';

export const phases = [
  { id: 'perception', name: '感知', english: 'PERCEIVE', description: '通过视觉与传感器观察环境，识别物体的位置和状态。' },
  { id: 'planning', name: '规划', english: 'PLAN', description: '结合目标与环境信息，选择动作并规划安全的运动路径。' },
  { id: 'action', name: '行动', english: 'ACT', description: '驱动身体与环境交互，让抽象的决策变成真实的动作。' },
  { id: 'feedback', name: '反馈', english: 'LEARN', description: '检查动作结果，更新对环境的理解，为下一次决策提供依据。' },
] as const;
