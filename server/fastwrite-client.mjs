/**
 * FastWrite 客户端 - 通过 API Key 与 FastWrite 服务集成
 */

export class FastWriteClient {
  constructor(baseURL, apiKey) {
    this.baseURL = baseURL.replace(/\/$/, '')
    this.apiKey = apiKey
  }

  /**
   * 发送请求到 FastWrite API
   */
  async request(method, path, body = null) {
    const url = `${this.baseURL}${path}`
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
    }

    const options = {
      method,
      headers,
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `FastWrite API error: ${response.status}`)
    }

    return data
  }

  /**
   * 获取所有项目列表
   */
  async listProjects() {
    return this.request('GET', '/api/integration/projects')
  }

  /**
   * 创建新项目
   */
  async createProject(title, options = {}) {
    return this.request('POST', '/api/integration/projects', {
      title,
      venue: options.venue,
      template: options.template,
    })
  }

  /**
   * 获取项目详情
   */
  async getProject(projectId) {
    return this.request('GET', `/api/integration/projects/${projectId}`)
  }

  /**
   * 编译项目
   */
  async compileProject(projectId) {
    return this.request('POST', `/api/integration/projects/${projectId}/compile`)
  }

  /**
   * 获取自动登录 token（需要 API Key 绑定用户）
   */
  async getAuthToken(identity = {}) {
    return this.request('POST', '/api/integration/auth/token', identity)
  }

  /**
   * 生成带自动登录的 FastWrite URL
   */
  async generateLoginUrl(projectId = null, identity = {}) {
    try {
      const { token } = await this.getAuthToken(identity)
      let path = projectId ? `/projects/${projectId}` : '/projects'
      return `${this.baseURL}${path}?token=${encodeURIComponent(token)}`
    } catch (error) {
      // An external identity must never silently fall back to an anonymous page.
      // That would make a failed account handoff look like a successful login.
      if (identity.externalAccountId) throw error
      // Preserve the legacy service-link behavior for callers without identity.
      console.warn('Failed to get auth token:', error.message)
      return projectId ? `${this.baseURL}/projects/${projectId}` : `${this.baseURL}/projects`
    }
  }

  /**
   * 检查连接状态
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.baseURL}/api/health`)
      return response.ok
    } catch {
      return false
    }
  }
}

/**
 * 创建 FastWrite 客户端实例
 */
export function createFastWriteClient(baseURL, apiKey) {
  if (!baseURL || !apiKey) {
    return null
  }
  return new FastWriteClient(baseURL, apiKey)
}
