# SDK API

<div align="center">

![version](https://img.shields.io/badge/version-v1-blue?style=for-the-badge)
![openapi](https://img.shields.io/badge/OpenAPI-3.0-green?style=for-the-badge)
![interfaces](https://img.shields.io/badge/interfaces-321-orange?style=for-the-badge)

</div>

> SDK帮助文档链接

---

## Contents

- [专辑](#专辑)  `20`
- [附件关联](#附件关联)  `6`
- [登录认证](#登录认证)  `8`
- [组织](#组织)  `31`
- [文档](#文档)  `58`
- [协作](#协作)  `24`
- [自定义图标](#自定义图标)  `7`
- [权限](#权限)  `22`
- [元数据](#元数据)  `29`
- [流程](#流程)  `1`
- [导航](#导航)  `1`
- [文档操作](#文档操作)  `9`
- [视图](#视图)  `9`
- [文件夹助手](#文件夹助手)  `5`
- [通知](#通知)  `2`
- [团队](#团队)  `22`
- [KM](#km)  `1`
- [LOGO](#logo)  `1`
- [外发](#外发)  `15`
- [共享](#共享)  `9`
- [最近](#最近)  `2`
- [任务中心](#任务中心)  `6`
- [外网外发](#外网外发)  `3`
- [用户模块](#用户模块)  `2`
- [回收站](#回收站)  `8`
- [搜索](#搜索)  `2`
- [文件收集](#文件收集)  `12`
- [模板](#模板)  `2`
- [传输](#传输)  `3`
- [水印](#水印)  `1`
- [文件上传之表单上传](#文件上传之表单上传)  `3`
- [文件下载](#文件下载)  `3`
- [导出PDF](#导出pdf)  `4`

---

## 专辑

### 添加专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/AddFavorite`

> 添加专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fsId` | `string` | — | 收藏夹id,当收藏到收藏夹根目录时 fsid为0 |
| `type` | `string` | — | 收藏类型 1文件夹 2文件 |
| `fvData` | `string` | — | 收藏文件（夹）id |
| `favName` | `string` | — | 收藏文件（夹）名称 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 新建专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/AddFavoriteClassify`

> 新建专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `favName` | `string` | — | 专辑名称 |
| `favRemark` | `string` | — | 专辑简介 |
| `isPrivate` | `integer(int32)` | — | 是否私密 0：公开；1：私有 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 收藏至专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/AddFavorites`

> 专辑文件（夹）

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fsId` | `string` | ✅ | 专辑id(多个使用,分割) |
| `types` | `string` | ✅ | 类型数组 1是文件夹，2是文件，(多个使用,分割)，要和ids 的文件文件夹顺序对应 |
| `ids` | `string` | ✅ | 收藏文件（夹）ids(多个使用,分割)，要和type 的文件文件夹顺序对应，例如"文件Id1,文件夹Id1,文件夹Id2,文件Id2"，,即"types": "30,24,25,33" |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件信息和专辑分类ID，取消专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/CancelFavorByElement`

> 根据文件信息和专辑分类ID，取消专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderids` | `array[integer(int32)]` | — | 文件夹ID |
| `fileids` | `array[integer(int32)]` | — | 文件ID |
| `fsID` | `array[integer(int32)]` | ✅ | 专辑ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 取消专辑所选择文件、文件夹

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/CancelFavoriteByIds`

> 取消专辑所选择文件、文件夹

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `params` | ❓ query | `string` | — | 逗号分割收藏项 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/DeleteFavoriteClassify`

> 删除专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fsId` | `string` | — | 专辑id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量取消专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/DeleteFavorites`

> 批量取消专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `ids` | `string` | — | 收藏ids，favoriteId,GetFavoritesByParentId（获取专辑文档列表）接口中获取该值 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 取消专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/DeleteFavoriteSearch`

> 取消专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fvId` | `integer(int32)` | — | 收藏Id dms_favor 表的主键 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 编辑专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/EditFavoriteClassifyName`

> 编辑专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fsId` | `string` | — | 收藏分类Id |
| `favName` | `string` | — | 收藏分类名称 |
| `favRemark` | `string` | — | 收藏备注 |
| `isPrivate` | `integer(int32)` | — | 是否私密 0：公开；1：私有 |
| `isOfficial` | `integer(int32)` | — | 是否官方 效果：（0：广场非置顶；1：广场置顶） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件类型和文件ID获取所属的专辑夹ID

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/GetBelongOfFavorites`

> 根据文件类型和文件ID获取所属的专辑夹ID

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `elementType` | `integer(int32)` | — | 文档类型（1：文件夹； 2：文件） ElementType 和ElementID 要对应，如果是ElementType是1 ElementID就要传文件Id，如果是2 就传文件夹Id |
| `elementID` | `string` | — | 文档编号，文件夹支持guid和id值；文件仅支持id值 ElementType 和ElementID 要对应，如果是ElementType是1 ElementID就要传文件Id，如果是2 就传文件夹Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件夹、文件获取专辑列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/GetBelongOfFavoritesMulti`

> 根据文件夹、文件获取专辑列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderids` | `array[integer(int32)]` | — | 文件夹ID |
| `fileids` | `array[integer(int32)]` | — | 文件ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据专辑id获取专辑文档信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/GetFavoriteById`

> 根据专辑id获取专辑文档信息

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — | 用户标识 |
| `fsid` | ❓ query | `integer(int32)` | — | 专辑id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取专辑分类列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/GetFavoriteClassifysByUserId`

> 获取专辑分类列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取专辑文档列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/GetFavoritesByParentId`

> 获取专辑文档列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `mnParentId` | `integer(int32)` | ✅ | 收藏分类id |
| `mnPermission` | `integer(int32)` | — | 权限值 |
| `docViewId` | `string` | — | 列表视图基本设置 |
| `argsXml` | `string` | ✅ | 视图信息，示例: ``` 1 20 basic:name false ``` `PageNum：当前分页 PageSize：分页大小 SortInfoName：排序字段 SortDesc：是否降序，true:降序；false：升序` |
| `noCalcPerm` | `boolean` | — | web端默认不计算权限（前端来控制），其他端默认计算权限 |
| `docType` | `integer(int32)` | — | 文件类型（-1：所有；1：ppt；2：word） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 内容广场-获取我的专辑列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/GetSquareFavoritesByParentId`

> 内容广场-获取我的专辑列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `mnParentId` | `integer(int32)` | — | 收藏分类id |
| `mnPermission` | `integer(int32)` | — | 权限值 |
| `currentIndex` | `integer(int32)` | ✅ | 页码 |
| `pageSize` | `integer(int32)` | ✅ | 视图Xml |
| `docType` | `integer(int32)` | — | 文件类型（-1：所有；1：ppt；2：word） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取广场所有公开的文件专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/GetSquareFileFavList`

> 获取广场所有公开的文件专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `keyword` | `string` | — | 专辑名称搜索关键词 |
| `pageNumber` | `integer(int32)` | ✅ | 页码 |
| `pageSize` | `integer(int32)` | ✅ | 页大小 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取用户专辑列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/GetTopFavorites`

> 获取用户专辑列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `keyword` | `string` | — | 专辑名称搜索关键词 |
| `pageNumber` | `integer(int32)` | — | 页码 |
| `pageSize` | `integer(int32)` | — | 页大小 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 移动专辑文档至其他专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/MoveFavorite`

> 移动专辑文档至其他专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fsId` | `string` | ✅ | 收藏分类Id |
| `fvId` | `string` | ✅ | 收藏id，GetFavoritesByParentId（获取专辑文档列表）接口中获取该值(对应字段：favoriteId) |
| `favName` | `string` | ✅ | 收藏分类名称 |
| `fvData` | `string` | ✅ | 收藏数据(就是文档id) FvData 和 FvType 保持一致，FvData 是文件id，FvType 就是2；FvData 是文件夹id，FvType 就是4 |
| `fvType` | `string` | ✅ | 收藏类型(文件节点2或者文件夹节点4) FvData 和 FvType 保持一致，FvData 是文件id，FvType 就是2；FvData 是文件夹id，FvType 就是4 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量移动文档至其他专辑

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/MoveFavorites`

> 批量移动文档至其他专辑

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fvIds` | `string` | ✅ | 主键Id数组(,分隔开)，favoriteId,GetFavoritesByParentId（获取专辑文档列表）接口中获取该值 |
| `fsId` | `string` | ✅ | 目标专辑id |
| `favNames` | `string` | ✅ | 分类名称数组主键Id数组(,分隔开)，收藏的文档名称 |
| `fvDatas` | `string` | ✅ | 收藏数据(,分隔开)，文档id,FvData 和 FvType 保持一致，FvData 是文件id，FvType 就是2；FvData 是文件夹id，FvType 就是4 |
| `fvTypes` | `string` | ✅ | 收藏类型数组,文件节点2或者文件夹节点4(,分隔开),FvData 和 FvType 保持一致，FvData 是文件id，FvType 就是2；FvData 是文件夹id，FvType 就是4 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改专辑用户行为排序

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Album/UpdateFavoritesSort`

> 修改专辑用户行为排序

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fsId` | `integer(int32)` | — | 拖动收藏id |
| `sort` | `integer(int32)` | — | 拖拽位置 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 附件关联

### 删除附件文件(单个附件删除)

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/AttachFile/DeleteAttachFile`

> 删除附件文件(单个附件删除)

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `attachFileId` | `integer(int64)` | ✅ | 附件文件id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取附件文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/AttachFile/GetAttachFile`

> 获取附件列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件id |
| `currentPage` | `integer(int32)` | ✅ | 页索引`起始页从1开始` |
| `pageSize` | `integer(int32)` | ✅ | 每页大小`(范围 1-100)` |
| `code` | `string` | — | 外发Code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量删除附件文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/AttachFile/RemoveAttachFileList`

> 批量删除附件文件

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `attachFileIdList` | `array[integer(int64)]` | ✅ | 附件文件id列表 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 创建关联文件列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RelationFile/CreateRelationFileList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `string` | ✅ | 文件编号集合，多个fileId以逗号","分隔 |
| `relatedFileIds` | `string` | ✅ | 关联文件ID，多个文件ID之间用","分隔 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[integer(int64)]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除关联文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RelationFile/DeleteRelationFile`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件编号 |
| `relatedFileId` | `integer(int64)` | ✅ | 关联文件编号 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取所有关联文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RelationFile/GetAllRelationFile`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件编号 |
| `pageIndex` | `integer(int32)` | ✅ | 当前页码 |
| `pageSize` | `integer(int32)` | ✅ | 每页大小 |
| `code` | `string` | — | 外发code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 登录认证

### 验证token是否正常

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Auth/CheckUserTokenValidity`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 当前登录用户token |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 发送邮件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Auth/SendEmailContent`

> inbiz消息引擎发送邮件

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `email` | `string` | — | 接收对象邮箱 |
| `inbizAppId` | `string` | — | inbiz appid站点 |
| `inibzTemplateKey` | `string` | — | inbiz 消息模板key |
| `content` | `string` | — | 发送内容 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 用户登录 修改背景：补充 UserLoginAsync 接口字段传参说明，便于 SDK 调用方区分必传和非必传参数。 修改人：meiruochen 修改时间：2026-06-22 修改内容：说明 UserName、Password 为必传，ValidateCodeSms 为启用验证码时必传，其余参数按登录场景非必传。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Auth/UserLogin`

> 用户登录 必传参数：UserName、Password。 条件必传参数：ValidateCodeSms，启用验证码时必传。 非必传参数：DomainIp、DeviceId、WeChatName、IsWechatType、ClientType、UserHostAddress、Secure、LocalVerNumber、RSASecure。 当前登录逻辑支持两种加密方式： 1、DES加密：Secure = true 表示使用DES。首先使用macrowing生成加密key；例如：EncryptDES("macrowing", "macrowing")。然后使用加密key，对账号/密码加密；例如：EncryptDES(账号/密码, 加密key)。 2、RSA公钥加密：RSASecure = true 表示使用RSA，客户端使用公钥加密账号/密码，服务端使用私钥解密，具体公钥获取接口地址为“/inbiz/org/api/auth/GetLoginRsaPublicKey”。 特别说明，如果Secure、RSASecure如果都传的true，则仍表示为RSA公钥加密。

<details>
<summary><b>Request Body  (登录信息。必传：UserName、Password；条件必传：ValidateCodeSms（启用验证码时）；非必传：DomainIp、DeviceId、WeChatName、IsWechatType、ClientType、UserHostAddress、Secure、LocalVerNumber、RSASecure。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `userName` | `string` | ✅ | 登录名 |
| `password` | `string` | ✅ | 密码 |
| `domainIp` | `string` | — | 域ip地址 |
| `deviceId` | `string` | — | 移动设备ID,非移动登录可以忽略 用于设备绑定,web调用忽略 IOS设备ID为64位、Android设备ID为32位，通过位数区分平台 |
| `weChatName` | `string` | — | 微信名称 |
| `isWechatType` | `string` | — | 是否是微信/钉钉登录 当WeChatName为空时,此参数忽略. 如果传递"true",则是微信登录，否则是钉钉登录 |
| `clientType` | `integer(int32)` | — | 客户端类型,传递的是int值 默认值:移动端登录(64) * ClientType 类型参考 * Web 0 Web类型 * WebService 1 WebService类型 * Temp 2 临时类型 * ClientEndpoint 4 客户端类型 * PCWebdav 8 PC Webdav * MobileWebdav 16 移动Webdav *  |
| `userHostAddress` | `string` | — | 用户IP地址 |
| `validateCodeSms` | `string` | — | 验证码 启用验证码时,此参数是必填项. |
| `secure` | `boolean` | — | 是否DES加密,默认true 默认加密，如需使用非加密模式，需要高级管理-服务参数设置中修改配置 加密模式下，需要账号和密码传入加密后的参数 加密方式： 1、生成加密key,首先使用macrowing生成加密key；例如：EncryptDES("macrowing", "macrowing") 2、使用加密key，对账号/密码加密；例如：EncryptDES |
| `localVerNumber` | `string` | — | 版本号 |
| `rsaSecure` | `boolean` | — | 用户名/密码是否使用 RSA 公钥加密 8.6新增 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
| `clientId` | `string` | 客户端ID，首次登录必须修改密码时才会返回值 |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 集成登录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Auth/UserLoginIntegrationByUserLoginName`

> 集成登录接口只能用数据库方式验证，不支持域验证、混合验证等其他验证方式

<details>
<summary><b>Request Body  (集成登录信息)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `loginName` | `string` | ✅ | 登录名 |
| `integrationKey` | `string` | ✅ | 集成登录约定的key值 集成登陆key : 系统管理=>安全策略=》登陆验证=》集成登陆密钥 |
| `clientType` | `integer(int32)` | — | 登录客户端类型，默认32：Integration集成 支持填写（32：Integration集成 64：Mobile移动端 128：VDrive 256：H5 ） 也可以使用自定义类型，随便填写四位数字，但是记录日志的类型始终为集成类型 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 用户登出

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Auth/UserLogout`

> 通过token登出用户

<details>
<summary><b>Request Body  (用户凭证)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 外部用户登录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/External/ExternalLogin`

> 手机号/邮箱发送验证码后登录，外部用户注册/登录

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `mobile` | `string` | — | 手机号，手机号码登录必填 |
| `email` | `string` | — | 邮箱，邮箱登录必填 |
| `state` | `string` | — | 登录类型，默认文件收集（collect:文件收集；external:外部用户登录） |
| `code` | `string` | ✅ | 验证码 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 外部用户发送验证码

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/External/ExternalLoginValidateCode`

> 外部用户发送短信、邮箱验证码

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `mobile` | `string` | — | 手机号，手机号码登录必填 |
| `email` | `string` | — | 邮箱，邮箱登录必填 |
| `state` | `string` | — | 登录类型，默认文件收集（collect:文件收集；external:外部用户登录） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取产品信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ProductConfig/GetProdInfo`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `vdlang` | `integer(int32)` | — | 配合VD端的多语言 1:en； 2:ja； 3:zh-tw；不传取默认zh-cn |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 组织

### 创建部门

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Department/CreateDepartment`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `name` | `string` | ✅ | 部门名称，字符最大长度200 |
| `parentId` | `string` | ✅ | 父级部门id，字符最大长度100 |
| `code` | `string` | — | 部门code，字符最大长度100 |
| `remark` | `string` | — | 备注，字符最大长度500 |
| `managerPositionName` | `string` | ✅ | 主管职位名称，字符最大长度200 |
| `thirdPartId` | `string` | — | 第三方id，字符最大长度100 |
| `enableTime` | `string(date-time)` | — | 结束时间 |
| `expirationTime` | `string(date-time)` | — | 过期时间 |
| `customInfo` | `object` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除部门

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Department/DeleteDepartmentById`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `string` | ✅ | 部门guid，字符最大长度100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改部门

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Department/EditDepartment`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `string` | ✅ | 部门id |
| `name` | `string` | ✅ | 部门名称（必填参数） |
| `parentId` | `string` | ✅ | 父级部门id（必填参数,上级部门ID哦） |
| `code` | `string` | — | 部门code |
| `remark` | `string` | — | 备注 |
| `sort` | `integer(int32)` | — | 排序 |
| `thirdPartId` | `string` | — | 第三方id，字符最大长度100 |
| `customInfo` | `object` | — |  |
| `enableTime` | `string(date-time)` | — | 结束时间 |
| `expirationTime` | `string(date-time)` | — | 过期时间 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取部门信息 by部门code

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Department/GetDepartmentInfoByCode`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `deptCode` | `string` | ✅ | 部门code,最大字符长度100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取部门信息 by部门Id

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Department/GetDepartmentInfoById`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `deptId` | `string` | ✅ | 部门guidId,最大字符长度100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取部门信息 by部门自增长的id

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Department/GetDepartmentInfoByIdentityId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `identityId` | `integer(int32)` | ✅ | 部门自增长的id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 通过关键字搜索部门列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Department/GetDepartmentInfoListByKeyword`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `keyword` | `string` | — | 部门名称关键字 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 查询子级部门

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Department/GetPageChildDepartmentList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `departmentId` | `string` | ✅ | 部门id,字符最大长度100 |
| `pageIndex` | `integer(int32)` | ✅ | 页索引`起始页从1开始` |
| `pageSize` | `integer(int32)` | ✅ | 每页大小`(范围 1-100)` |
| `recursive` | `boolean` | — | 是否包括子级 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 添加用户插入到职位

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/AddUserToPosition`

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userIdList` | `array[string]` | ✅ | 用户id列表（无值为空数组[]） 最大数组长度100，如需更大场景请自行分批次调用 |
| `positionId` | `string` | ✅ | 职位ID,字符最大长度是100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 创建职位

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/CreatePosition`

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `name` | `string` | ✅ | 职位名称，字符最大长度200 |
| `code` | `string` | — | 职位编号，字符最大长度100 |
| `parentId` | `string` | ✅ | 上级职位Id，字符最大长度100 |
| `levelId` | `integer(int32)` | ✅ | 职等 |
| `remark` | `string` | — | 备注，字符最大长度500 |
| `enableTime` | `string(date-time)` | — | 启用时间 |
| `expirationTime` | `string(date-time)` | — | 过期时间 |
| `thirdPartId` | `string` | — | 第三方id，字符最大长度200 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除职位

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/DeletePositionById`

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `string` | ✅ | 职位ID,字符最大长度是100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改职位

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/EditPosition`

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `name` | `string` | ✅ | 职位名称，字符最大长度200 |
| `code` | `string` | — | 职位编号，字符最大长度100 |
| `parentId` | `string` | ✅ | 上级职位Id，字符最大长度100 |
| `levelId` | `integer(int32)` | ✅ | 职等 |
| `remark` | `string` | — | 备注，字符最大长度500 |
| `enableTime` | `string(date-time)` | — | 启用时间 |
| `expirationTime` | `string(date-time)` | — | 过期时间 |
| `thirdPartId` | `string` | — | 第三方id，字符最大长度200 |
| `id` | `string` | ✅ | 职位ID，字符最大长度100 |
| `sort` | `integer(int32)` | — | 自定义排序位置的值，成员选择会按照此值从小到大进行排序 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 通过职位Code获取职位信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/GetPositionInfoByCode`

> 通过职位Code获取职位信息

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `positionCode` | `string` | ✅ | 职位Code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取职位信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/GetPositionInfoById`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `positionId` | `string` | ✅ | 职位id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取职位信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/GetPositionInfoByIdentityId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `identityId` | `integer(int32)` | ✅ | 职位自增id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 通过关键字搜索职位列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/GetPositionInfoListByKeyword`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `keyword` | `string` | — | 关键字 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 从职位中移除用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Position/RemoveUserFromPosition`

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userIdList` | `array[string]` | ✅ | 用户id列表（无值为空数组[]） 最大数组长度100，如需更大场景请自行分批次调用 |
| `positionId` | `string` | ✅ | 职位ID,字符最大长度是100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 创建用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/CreateUser`

<details>
<summary><b>Request Body  (用户信息)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `name` | `string` | ✅ | 用户名，字符最大长度200 |
| `account` | `string` | ✅ | 账号名，字符最大长度100 |
| `code` | `string` | — | 编号，字符最大长度100 |
| `email` | `string` | — | 电子邮件，字符最大长度100 |
| `gender` | `integer(int32)` | — |  |
| `telephone` | `string` | — | 座机电话，字符最大长度50 |
| `mobile` | `string` | — | 手机号，字符最大长度50 |
| `fax` | `string` | — | 传真，字符最大长度50 |
| `enableTime` | `string` | — | 启用时间 |
| `expirationDate` | `string` | — | 过期时间 |
| `birthday` | `string` | — | 生日 |
| `groupIdList` | `string` | — | 用户组列表 |
| `positionList` | `array[object]` | ✅ | 职位列表，必须有一个值 |
| `thirdPartId` | `string` | — | 第三方ID，字符最大长度500 |
| `remark` | `string` | — | 用户备注，字符最大长度500 |
| `status` | `integer(int32)` | — | 用户状态 * 0 正常 * 1 注销 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改用户信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/EditUser`

<details>
<summary><b>Request Body  (用户信息)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `name` | `string` | ✅ | 用户名 |
| `id` | `string` | — | 用户ID，字符最大长度100 |
| `identityId` | `integer(int32)` | — | 用户ID |
| `email` | `string` | — | 电子邮件，字符最大长度100 |
| `gender` | `integer(int32)` | — |  |
| `telephone` | `string` | — | 座机电话，字符最大长度50 |
| `mobile` | `string` | — | 手机号，字符最大长度50 |
| `fax` | `string` | — | 传真，字符最大长度50 |
| `enableTime` | `string` | — | 启用时间 |
| `expirationDate` | `string` | — | 过期时间 |
| `birthday` | `string` | — | 生日 |
| `groupIdList` | `string` | — | 用户组列表 |
| `mainDid` | `string` | — | 主职位对应的部门id |
| `positionList` | `array[object]` | ✅ | 职位列表 |
| `remark` | `string` | — | 用户备注，字符最大长度500 |
| `code` | `string` | — | 用户code |
| `thirdPartId` | `string` | — | 第三方id |
| `password` | `string` | — | 密码 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 查询用户个人库文件夹信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/GetTopPersonalFolderId`

<details>
<summary><b>Request Body  (用户信息)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userId` | `string` | — | 用户GUID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取用户信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/GetUserInfoByAccount`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `account` | `string` | ✅ | 用户账号 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据自增长ID获取用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/GetUserInfoByIdentityId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `identityId` | `integer(int32)` | ✅ | 用户IdentityId |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/GetUserInfoByToken`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据GUID获取用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/GetUserInfoByUserId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userId` | `string` | — | 用户GUID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取用户列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/GetUsers`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `orgType` | `integer(int32)` | ✅ | 组织类型 * 2 部门 * 4 职位 * 16 主管职位 |
| `orgId` | `string` | — | 组织ID， 对应组织类型，选择什么类型就传对应的ID 字符最大长度100 |
| `recursive` | `boolean` | — | 是否包含子级 |
| `pageIndex` | `integer(int32)` | — | 页索引`起始页从1开始` |
| `pageSize` | `integer(int32)` | — | 每页大小`(范围 1-100)` |
| `status` | `integer(int32)` | — | 用户状态 * 0 获取正常 * 1 获取已注销 * 2 获取锁定 * 3 获取非注销 * 4 获取全部 |
| `searchContent` | `string` | — | 关键字搜索，字符最大长度100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 注销用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/LogoffUser`

> 注销用户

<details>
<summary><b>Request Body  (用户GUID信息)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userId` | `string` | — | 用户GUID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 置顶排序用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/StickUserByUserId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userId` | `string` | ✅ | 要置顶或者取消置顶的用户userId |
| `orgType` | `integer(int32)` | ✅ | 组织类型：1或者2表示部门 ；4：职位 8：虚拟职位 16：主管职位 |
| `orgId` | `string` | ✅ | 组织ID：要置顶或者取消置顶的用户的当前所在部门guid 或者职位guid 和OrgType要配套：OrgType 是部门，则OrgId 也要是部门ID；反之就是职位ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 取消置顶排序用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/User/UnStickUserByUserId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userId` | `string` | ✅ | 要置顶或者取消置顶的用户userId |
| `orgType` | `integer(int32)` | ✅ | 组织类型：1或者2表示部门 ；4：职位 8：虚拟职位 16：主管职位 |
| `orgId` | `string` | ✅ | 组织ID：要置顶或者取消置顶的用户的当前所在部门guid 或者职位guid 和OrgType要配套：OrgType 是部门，则OrgId 也要是部门ID；反之就是职位ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 添加用户到用户组

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/UserGroup/AddUsersIntoGroup`

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userList` | `array[object]` | ✅ | 用户列表 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据用户组名称查询用户组信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/UserGroup/GetGroupsByName`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `dataFilter` | `integer(int32)` | — | 是否隐藏一些固定用户组，1:Everyone,2:Creator,4:系统管理员,可通过或运算隐藏多个，默认9 |
| `groupName` | `string` | — | 用户组名称 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 从用户组移除用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/UserGroup/RemoveUsersFromGroup`

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userList` | `array[object]` | ✅ | 用户列表 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 文档

### 列表导出

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Doc/ExportFolderChildren`

> 列表导出

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `startNum` | `integer(int32)` | — | 导出数据范围 |
| `endNum` | `integer(int32)` | — | 导出数据范围 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id |
| `exportColumns` | `array[string]` | ✅ | 要导出的列，当前视图显示的列头，有格式要求 例如 基础字段basic:name,元数据字段例如meta:250409113222-edoc2Textbox\text20250409113236700\文本 |
| `sortField` | `string` | — | 排序字段 ExportColumns中的某个字段,非筛选场景必传 |
| `sortDesc` | `boolean` | — | 是否倒序，非筛选场景必传 |
| `specifyFolderIds` | `array[integer(int32)]` | — | 要导出的指定文件夹id SpecifyFolderIds或SpecifyFileIds任一有值时导出范围参数StartNum、EndNum则不生效 |
| `specifyFileIds` | `array[integer(int64)]` | — | 要导出的指定文件id SpecifyFolderIds或SpecifyFileIds任一有值时导出范围参数StartNum、EndNum则不生效 |
| `searchParms` | `object` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 判断是否是轻文档。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/CheckDocflow`

> 判断是否是轻文档。

<details>
<summary><b>Request Body  (判断文件是否为轻文档的请求参数。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `string` | ✅ | 文件 ID 或文件 GUID。 |
| `code` | `string` | — | 外发编号。 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 创建轻文档

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/CreateDocFlowFile`

> 创建轻文档

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `string` | ✅ | 文件夹id |
| `fileName` | `string` | ✅ | 文件名 |
| `fileDesc` | `string` | — | 说明 |
| `templateId` | `string` | — | 轻文档模板Id |
| `msgSource` | `integer(int32)` | — | 10系统新建、vd/vbox不传默认10 |
| `type` | `string` | ✅ | 只支持在线文档 .mdoc |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取轻文档导出任务进度。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/ExportMDocProgress`

> 获取轻文档导出任务进度。

<details>
<summary><b>Request Body  (导出任务进度查询请求参数。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `string` | ✅ | 文件id或guid |
| `code` | `string` | ✅ | 第一步创建的导出任务 code。 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 创建轻文档导出任务。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/ExportMDocStep1`

> 创建轻文档导出任务。

<details>
<summary><b>Request Body  (创建导出任务请求参数。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `string` | ✅ | 文件id或guid |
| `jsonContent` | `string` | — | 导出轻文档所需的 json 字符串。 |
| `exportType` | `string` | — | 导出文件类型，支持 docx、pdf、md。 |
| `templateId` | `integer(int64)` | — | 导出使用的模板 ID。 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 下载轻文档导出生成成功的文件。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/ExportMDocStep2`

> 下载轻文档导出生成成功的文件。

<details>
<summary><b>Request Body  (导出文件下载请求参数。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `string` | ✅ | 文件id或guid |
| `code` | `string` | ✅ | 第一步创建的导出任务 code。 |

</details>

<details>
<summary><b>Response</b></summary>

🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 查询普通文件导入轻文档任务的处理进度。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/ImportFileAsMDocProgress`

> 查询普通文件导入轻文档任务的处理进度。

<details>
<summary><b>Request Body  (导入转换任务进度查询请求参数。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `taskId` | `string` | ✅ | 导入转换任务 ID。 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 创建普通文件导入轻文档转换任务。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/ImportFileAsMDocStep1`

> 创建普通文件导入轻文档转换任务。

<details>
<summary><b>Request Body  (创建导入转换任务的请求参数。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 目标 OC 文件夹 ID。 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 基于已上传到 OC 的普通文件触发轻文档转换流程。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/ImportFileAsMDocStep2`

> 基于已上传到 OC 的普通文件触发轻文档转换流程。

<details>
<summary><b>Request Body  (触发转换请求参数。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `taskId` | `string` | ✅ | 第一步创建的导入转换任务 ID。 |
| `fileId` | `integer(int64)` | ✅ | 已上传到 OC 的源文件 ID。 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改文件属性

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/ChangeFileById`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件ID |
| `newName` | `string` | — | 文件修改名称(传空则不修改名称),字符最大长度200 |
| `remark` | `string` | — | 文件备注,字符最大长度200 |
| `fileCode` | `string` | — | 文件编号,字符最大长度100 |
| `effectiveTime` | `string` | — | 文件生效时间 如;2019-10-22 (ISO8601) |
| `expirationTime` | `string` | — | 文件过期时间 如;2019-10-22 (ISO8601) |
| `levelId` | `string` | — | 文件密级 * 0 未设置密级 * 1 非密 * 2 内部 * 3 秘密 * 4 机密 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 更改文件夹信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/ChangeFolderInfo`

> **Responses.result错误** * 7:文件夹名称格式错误

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id |
| `newName` | `string` | ✅ | 新文件夹名称 最大长度不能超过240个字符 |
| `remark` | `string` | — | 备注 最大长度不能超过500个字符 |
| `folderCode` | `string` | — | 文件夹code值 最大长度不能超过100个字符 |
| `secretLevel` | `integer(int32)` | — | 文件密级 * 0 未设置密级 * 1 非密 * 2 内部 * 3 秘密 * 4 机密 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 创建置顶记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/CreateTopRecord`

<details>
<summary><b>Request Body  (创建置顶记录输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `parentFolderId` | `integer(int32)` | ✅ | 父级文件夹Id(当前展开的文件夹Id) |
| `viewId` | `integer(int32)` | ✅ | 视图Id |
| `eneryId` | `integer(int64)` | ✅ | 需要置顶的文件\文件夹Id |
| `eneryType` | `integer(int32)` | ✅ | 需要置顶操作的类型（1：文件夹 2：文件） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除置顶记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/DeleteTopRecord`

<details>
<summary><b>Request Body  (删除置顶记录输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `parentFolderId` | `integer(int32)` | ✅ | 父级文件夹Id(当前展开的文件夹Id) |
| `recordIds` | `string` | ✅ | 置顶记录自增ID(多个id用“逗号”隔开) |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件或文件夹删除置顶记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/DeleteTopRecordByFilesORFolders`

<details>
<summary><b>Request Body  (删除置顶记录文件输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `parentFolderId` | `integer(int32)` | ✅ | 父级文件夹Id(当前展开的文件夹Id) |
| `fileIds` | `string` | — | 文件ID(多个id用“逗号”隔开) |
| `folderIds` | `string` | — | 文件夹ID(多个id用“逗号”隔开) |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件夹ID启用外网直连

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/EnableDirectOuterNetByFolderId`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — | 认证Token |
| `folderId` | ❓ query | `integer(int32)` | — | 文件夹ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件夹id批量获取文件夹下的文件

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetChildFilePageListByFolderId`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `folderId` | ❓ query | `integer(int32)` | ✅ | 文件夹id |
| `pageIndex` | ❓ query | `integer(int32)` | ✅ | 当前页码 起始页从1开始 |
| `pageSize` | ❓ query | `integer(int32)` | ✅ | 每页大小(范围 1-100) |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 批量删除文件

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetDeleteFileInfosByFileIds`

> 包含已删除的文件

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `fileIds` | ❓ query | `string` | ✅ | int类型的文件ID，多个文件ID 用,号分隔,最大支持50个 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |

</details>

---

### 根据文件id或文件guid获取文件信息

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFileByIdOrGuid`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `fileIdOrGuid` | ❓ query | `string` | ✅ | 文件id或者文件Guid |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取单个文件信息文件

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFileInfoById`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `fileId` | ❓ query | `integer(int64)` | ✅ | 文件id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 批量获取文件

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFileInfosByFileIds`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `fileIds` | ❓ query | `string` | ✅ | int类型的文件ID，多个文件ID 用,号分隔,最大支持50个 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |

</details>

---

### 获取文件md5

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFileMd5ByFileId`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `fileId` | ❓ query | `integer(int64)` | — | 文件id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 获取文件区域信息

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFileRegionInfoByFileId`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `fileId` | ❓ query | `integer(int64)` | — | 文件id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取文件夹信息，支持文件夹guid和id获取

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFolderByGuidOrId`

> 获取文件夹信息

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `string` | ✅ | 文件夹guid或文件夹id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取文件和文件夹列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFolderChildren`

> 修改背景：SDK 获取文件夹子列表时，字典中的 shortcut 嵌套对象反序列化后以 JToken 形态返回，导致实际响应中 shortcut 属性值变为空数组。 修改人：haiwei.cui 修改时间：2026-06-15 修改内容：返回前递归还原 JToken 为普通 Dictionary/List/基础值，保证 shortcut 字段按内部服务结果输出。

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | — | 外发code，外发时必传 |
| `fid` | `string` | ✅ | 文件夹id或者guid |
| `argsXml` | `string` | ✅ | 视图信息 |
| `noCalcPerm` | `boolean` | — | 是否计算权限， 默认值：false， true:不计算权限;false:计算权限 |
| `viewId` | `integer(int32)` | — | 视图id |
| `collectCode` | `string` | — | 收集任务code，文件收集功能专用 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件夹信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFolderInfoById`

> 获取文件夹信息

<details>
<summary><b>Request Body  (参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取实例配置

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetInstanceConfig`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — | 认证Token |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 列表筛选

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetMapSearchResultList`

> 列表筛选

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `mnId` | `integer(int32)` | — | 父文件夹id |
| `docViewId` | `integer(int32)` | — | 视图id |
| `argsXml` | `string` | — | 分页参数 |
| `searchXml` | `string` | — | 查询语句 |
| `startNum` | `integer(int32)` | — | 起始条数 |
| `metaDataSearch` | `boolean` | — | 是否是元数据搜索 |
| `searchType` | `string` | — | 搜索类型，MixFile：文件内容查询；文件名查询:MixFile；MetaFolder：文件夹查询；TagFile：标签查询 |
| `searchLocation` | `string` | — | 搜索范围，包含值：enterprise：企业库、team：团队库、person：个人库、knowledge：知识库 |
| `searchLibrary` | `string` | — | 搜索目录，可以不传，知识库搜索是不可以传值 包含值：all：三库搜索、enterprise：企业库、team：团队库、person：个人库 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取置顶记录列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetTopRecordList`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — | 认证Token |
| `parentFolderId` | ❓ query | `integer(int32)` | — | 父文件夹ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改文件密级

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/ModifyFileSecurity`

<details>
<summary><b>Request Body  (修改文件密级输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `string` | ✅ | 文件ID字符串，例如：134,133 |
| `levelId` | `integer(int32)` | ✅ | 密级id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置置顶记录排序

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/SetTopRecordSort`

<details>
<summary><b>Request Body  (设置置顶记录排序输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `parentFolderId` | `integer(int32)` | ✅ | 父级文件夹ID |
| `recordId` | `integer(int32)` | ✅ | 拖拽的置顶记录表自增id |
| `offset` | `integer(int32)` | ✅ | 偏移量 （x-y） 元素向排序大的方向移动时，offset的为正值；若往排序小的方向移动时，offset`为负值 x小于y 时，则将(x, y)范围内的元素都减1 x大于y 时，则将(y, x)范围内的元素都加1 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量更新文件（夹）信息接口

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/UpdateDocumentInfoBatch`

> 批量更新文件（夹）信息接口

<details>
<summary><b>Request Body  (data参数说明： {"DocId": 1,"DocType": 2,"ChangeColumns": [{"ColumnName": "basic:Title","ColumnValue": "新标题"},{"ColumnName": "meta:Tags","ColumnValue": "文档"}]} *lable:valueText* * DocId：文档id * DocType 文档类型 文件：2，文件夹：1 * ChangeColumns：修改的键值对 * ColumnName：修改的列名 基本列basic:xxxx；元数据列meta:xxxx * ColumnValue：修改的值)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `data` | `string` | ✅ | 请求参数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 获取三库名称

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocView/GetProdInfo`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 校验轻文档是否发布

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/File/CheckDocFlowsIsPublish`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `string` | — | 文件Id字符串，多个逗号分隔 |
| `showFailedDetails` | `boolean` | — | 是否显示失败文件详细信息 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 根据标签名称删除文件标签

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FileTag/DeleteFileTagByTagName`

> 根据标签名称删除文件标签

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `tagName` | `string` | ✅ | 标签名称 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取用户拥有的标签列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FileTag/GetCurrentUserTagList`

> 获取当前用户所有标签的列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[string]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取标签文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FileTag/GetFileListByTag`

> 获取标签文件列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `tagName` | `string` | — | 标签名称 |
| `pageNum` | `integer(int32)` | — | 页码 |
| `pageSize` | `integer(int32)` | — | 分页数量 |
| `sortField` | `string` | — | 排序字段 |
| `sortDesc` | `boolean` | — | 是否降序 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件拥有的标签列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FileTag/GetFileTags`

> 获取文件标签

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `string` | ✅ | 文件编号 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取用户拥有的标签列表(分页接口)

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FileTag/GetTagListPage`

> 分页获取我的标签列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageIndex` | `integer(int32)` | ✅ | 页码 |
| `pageSize` | `integer(int32)` | ✅ | 分页数量 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除文件标签

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FileTag/RemoveFilesTag`

> 删除文件标签

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `string` | ✅ | 文件编号，以逗号分隔 |
| `tagName` | `string` | ✅ | 标签名称 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量设置标签

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FileTag/SetFileTags`

> 设置文件标签

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `string` | ✅ | 文件编号,以逗号分隔 |
| `insertData` | `string` | — | 插入标签名称,以逗号分隔 |
| `deleteData` | `string` | — | 删除标签编号,以逗号分隔 示例："4a2f30e5349848b9b45a0809618b43ad"//要删除的tagId，该值从GetFileTags接口中获取(tagId字段) |
| `sendMsg` | `boolean` | — | 是否发送标签变更消息，默认不传为true，主动事件编排调用时会传递false |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量获取文件夹

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/Folder/GetFoldersByIdentityIds`

> 批量获取文件夹

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `folderIds` | ❓ query | `string` | ✅ | 多个文件夹ID 用,号分隔（eg:`100,200`）,最多支持100个 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |

</details>

---

### 策略设置-基本策略-文件编号生成规则

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderBasicSet/SetFolderCodeRule`

> 文件夹策略中基本策略设置时获取文件编号生成规则接口 argsXml参数示例： ```xml (lable) (valueText) (lable2) (valueText2) ```

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹ID |
| `xmlCfg` | `string` | ✅ | 规则配置 XML 字符串。 字段说明： - isEnable：是否启用，默认 true。 - genMode：生成模式，1=固定字符，2=日期时间，3=编号自增长，6=所属文件夹名，7=文件创建人名称，8=文件创建人部门编号，9=文件创建人部门名称。 - fixChar：固定字符，genMode 为 1 时填写，其他类型传空，长度不能超过 100。 - da |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 删除文件夹模板

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderTemplate/DeleteFolderTemplate`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `docTemplateId` | `integer(int32)` | ✅ | 模板id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |

</details>

---

### 文件夹模板详情

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderTemplate/FolderTemplateInfo`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `docTemplateId` | `integer(int32)` | ✅ | 模板id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取模板文件夹列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderTemplate/GetPagedFolderTedmplateListBySearch`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `isTarageDirectory` | `boolean` | — | 是否指定目录 默认设置为true 即可（true:指定目录） （false:全部） |
| `currentFolderId` | `integer(int32)` | ✅ | 目录文件夹id |
| `templateName` | `string` | — | 模板名称搜索 |
| `pageIndex` | `integer(int32)` | ✅ | 页码 |
| `pageSize` | `integer(int32)` | ✅ | 分页大小 |
| `orderField` | `string` | — | 排序列 |
| `orderDesc` | `boolean` | — | 排序类型 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 修改文件夹模板

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderTemplate/ModifyFolderTemplate`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `docTemplateId` | `integer(int32)` | ✅ | 模板id |
| `docTemplateName` | `string` | ✅ | 模板名称 |
| `description` | `string` | — | 模板说明 |
| `isTarageDirectory` | `boolean` | — | 是否指定目录 true 指定目录 |
| `docTemplateIcon` | `string` | — | 模板图标,要传inbiz 规定的icon 图标 |
| `templateTargetDirectoryFolders` | `array[object]` | — | 模板使用范围 |
| `isEveryOne` | `boolean` | — | 是否所有人 |
| `members` | `array[object]` | — | 模板用户 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |

</details>

---

### 设为文件夹模板

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderTemplate/SetFolderTemplate`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `docTemplateName` | `string` | ✅ | 模板名称 |
| `description` | `string` | — | 模板说明 |
| `isChildrenFile` | `boolean` | ✅ | 是否包含子级文件 |
| `sourcefolderid` | `integer(int32)` | ✅ | 原文件夹id |
| `isTarageDirectory` | `boolean` | ✅ | 是否指定目录 默认设置为true 即可（true:指定目录） （false:全部） |
| `docTemplateIcon` | `string` | — | 模板图标 |
| `templateTargetDirectoryFolders` | `array[object]` | ✅ | 模板使用范围 |
| `isEveryOne` | `boolean` | ✅ | 是否所有人 |
| `members` | `array[object]` | ✅ | 模板用户 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |

</details>

---

### 从文件夹模板新建

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderTemplate/TemplateFolderCreate`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `currentParentFolderId` | `integer(int32)` | ✅ | 当前父级文件夹id |
| `docTemplateId` | `integer(int32)` | ✅ | 模板Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 文件夹重命名

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationRename/ChangeFolderName`

> 文件夹重命名

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `newName` | `string` | ✅ | 新名称 |
| `folderId` | `integer(int32)` | ✅ | 文件夹ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 文件重命名

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationRename/RenameFile`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `newName` | `string` | ✅ | 新名称 |
| `fileId` | `integer(int64)` | ✅ | 文件ID |
| `shareCode` | `integer(int32)` | — | 共享code,用于 共享出去的轻文档可以修改文件名称，需要传共享code校验是否编辑权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 创建引用

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationShortcut/CreateShortcut`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `parentId` | `string` | ✅ | 父级文件夹Id |
| `name` | `string` | ✅ | 名称 |
| `entryId` | `string` | ✅ | 对象id |
| `entryType` | `string` | ✅ | 类型 文件夹=1 文件=2 |
| `config` | `string` | — | 配置 |
| `other` | `string` | — | 其他 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 获取文件版本信息

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/RightSidePanel/GetFileVerByFileVerId`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ |  |
| `fileId` | ❓ query | `integer(int64)` | ✅ |  |
| `fileVerId` | ❓ query | `integer(int64)` | ✅ |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取版本列表

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/RightSidePanel/GetFileVersionListByFileId`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `fileId` | ❓ query | `integer(int64)` | ✅ | 文件id |
| `pageNumber` | ❓ query | `integer(int32)` | ✅ | 页索引起始页从1开始 |
| `pageSize` | ❓ query | `integer(int32)` | ✅ | 每页大小(范围 1-100) |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 发布文件版本

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RightSidePanel/PublishFileVersion`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | — | 文件ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 版本删除

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RightSidePanel/RecycleFileVer`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件id |
| `fileVerId` | `integer(int64)` | ✅ | 需要删除的版本id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |

</details>

---

### 文件版本回滚

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RightSidePanel/SetCurrentFileVersion`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件id |
| `fileVerId` | `integer(int64)` | ✅ | 设为主板本的版本id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |

</details>

---

### 修改文件密级

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/SecurityLevel/ModifyFileSecurity`

> 批量修改文件密级

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `string` | ✅ | 文件ID字符串，例如：134,133 |
| `levelId` | `integer(int32)` | ✅ | 密级id 0 未设置密级 1 非密 2 内部 3 秘密 4 机密 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 新建文件夹

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/TemplateCreate/CreateFolder`

> 新建文件夹

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `name` | `string` | ✅ | 文件夹名 最大长度不能超过240个字符 |
| `remark` | `string` | — | 备注 最大长度不能超过500个字符 |
| `code` | `string` | — | 文件夹编号 最大长度不能超过100个字符 |
| `parentFolderId` | `string` | ✅ | 父级文件夹id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>


## 协作

### 创建协作文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/CreateCollaborationFile`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileName` | `string` | ✅ | 文件名 |
| `fileDesc` | `string` | — | 说明 |
| `templateId` | `string` | — | 模板Id ，从模板创建时传递 |
| `msgSource` | `integer(int32)` | — | 10系统新建、vd/vbox不传默认10 |
| `type` | `string` | ✅ | 文件类型 .pptx .ppt .docx .doc .xls .xlsx .mdoc 从模板新建普通office时传递空，创建的是轻文档时传递 .mdoc |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除协作分类

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/DeleteCollaborationClass`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `collaborationClassId` | `integer(int32)` | — | 协作分类id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除协作分类文件记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/DeleteCollaborationClassFileRecord`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `array[integer(int64)]` | — | 文件ids |
| `collaborationClassIds` | `array[integer(int32)]` | — | 协作分类id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除我的审批记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/DeleteMyDocflowRecord`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `array[integer(int64)]` | ✅ | 文件ids |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件ID获取协作分类文件记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetCollaborationClassFileRecordByFileIds`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `array[integer(int64)]` | — | 文件ids |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取协作分类列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetCollaborationClassList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取协作文件夹信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetCollaborationFolderInfo`

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件ID获取协作链接

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetCollaborationLinkByFileId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取协作链接权限分类列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetCollaborationLinkPermCategoryList`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取轻文档本地上传根目录。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetDocflowRootFolder`

> 获取轻文档本地上传根目录

<details>
<summary><b>Request Body  (SDK 基础入参，携带 token。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文件ID获取我的审批记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetMyDocflowRecordByFileId`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — |  |
| `fileId` | ❓ query | `string` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取我的审批记录列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetMyDocflowRecordList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageSize` | `integer(int32)` | — | 分页大小（默认30） |
| `pageNum` | `integer(int32)` | — | 页数（默认1） |
| `docType` | `integer(int32)` | — | 文档类型（-1：全部；1：我创建的，2：我协助的，3：我的未读，4：我批注的 默认-1） |
| `cateId` | `integer(int32)` | — | 分类标识（轻文档标签id，-1:默认全部） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取未读数量

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/GetUnReadCount`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 邀请用户

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/InviteUser`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `bizType` | `string` | — | 类型,固定传递"ecm" |
| `bizCode` | `string` | ✅ | 文件id |
| `targetUserIds` | `string` | ✅ | 目标用户(共享给谁,或者叫做邀请得谁,多个用户用英文逗号分隔，如1,2,3,4) |
| `shareId` | `integer(int32)` | — | -1/0编辑,其他表示新加 |
| `startDateTime` | `string` | — | 个人库邀请--开始时间 |
| `endDateTime` | `string` | — | 个人库邀请--结束时间 传空字符串表示永久 |
| `perm` | `integer(int32)` | — | 个人库邀请--分配得权限 |
| `permCateId` | `integer(int32)` | — | 协作库文件邀请，权限类别id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 加入协作

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/JoinCollaboration`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — |  |
| `collaborationCode` | ❓ query | `string` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改协作分类列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/ModifyCollaborationClassList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `collaborationClassInput` | `array[object]` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 移除协作记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/Remove`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `array[integer(int64)]` | ✅ | 文件ids |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 搜索我的审批记录列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/SearchMyDocflowRecordList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageSize` | `integer(int32)` | — | 分页大小（默认30） |
| `pageNum` | `integer(int32)` | — | 页数（默认1） |
| `keyword` | `string` | — | 关键字 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置协作分类

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/SetCollaborationClass`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `array[integer(int64)]` | — | 文件ids |
| `collaborationClassIds` | `array[integer(int32)]` | — | 协作分类ids |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置已读

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/SetRead`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置置顶

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/SetTop`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `array[integer(int64)]` | ✅ | 文件ids |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 取消置顶

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/UnsetTop`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIds` | `array[integer(int64)]` | ✅ | 文件ids |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 更新协作链接

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Docflow/UpdateCollaborationLink`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 邀请链接code |
| `cateId` | `integer(int32)` | ✅ | 权限类别id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置协作文件权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/SetCollebrationFilePermission`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件id |
| `permission` | `string` | ✅ | 权限信息 参数示例："1,23,3,13009721,,,2097193,2,57,10\n" 可多项，每项以\n结尾 参数解释：以','分隔分别释义 (1),成员类型, //1：用户 2：部门 8：用户组 (2)成员id, (3)操作类型, //1：新增 2：删除 3：修改, (4)权限值, //文件权限类别中对应perm值 (5)生效开始时间, //可为 |
| `permTemplate` | `integer(int32)` | ✅ | 固定传-1 |
| `secCateId` | `integer(int32)` | ✅ | 固定传0 |
| `secEntryLevel` | `integer(int32)` | ✅ | 固定传0 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 自定义图标

### 删除文件夹图标

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocIcon/DeleteFolderIcon`

<details>
<summary><b>Request Body  (文件夹输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件缩略图

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocIcon/GetFileThumbnail`

<details>
<summary><b>Request Body  (文件GUID输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileGuid` | `string` | ✅ | 文件guid |

</details>

<details>
<summary><b>Response</b></summary>

🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件夹图标

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocIcon/GetFolderIcon`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 认证Token |
| `fileKey` | ❓ query | `string` | ✅ | 图标存储Key |

</details>

<details>
<summary><b>Response</b></summary>

🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量获取文件夹图标

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocIcon/GetFolderIconBatch`

<details>
<summary><b>Request Body  (文件夹ID列表输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderIds` | `array[integer(int32)]` | ✅ | 文件夹编号集合 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 移除文件自定义缩略图

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocIcon/RemoveFileCustomThumbnail`

<details>
<summary><b>Request Body  (文件GUID输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileGuid` | `string` | ✅ | 文件guid |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 上传文件自定义缩略图 仅支持大于0KB，小于1MB的.bmp，.jpeg，.jpg，.png，.gif格式图片 最大支持600*600像素图片

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocIcon/UploadFileCustomThumbnail`

> 上传文件自定义缩略图:仅支持大于0KB，小于1MB的.bmp，.jpeg，.jpg，.png，.gif格式图片，最大支持600*600像素图片

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `fileGuid` | ❓ query | `string` | ✅ | 文件GUID |

</details>

<details>
<summary><b>Request Body</b></summary>



</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 上传文件夹图标 仅支持大于0KB，小于1MB的.bmp，.jpeg，.jpg，.png，.gif格式图片 最大支持600*600像素图片

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocIcon/UploadFolderIcon`

> 上传文件夹图标:仅支持大于0KB，小于1MB的.bmp，.jpeg，.jpg，.png，.gif格式图片，最大支持600*600像素图片

<details>
<summary><b>Request Body</b></summary>



</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 权限

### 批量计算当前用户的文件夹和文件权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/CalcDocPermissions`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `docIds` | `string` | — | 需要计算权限的文档信息，格式：文档类型:文档id，多个|符号分割 文档类型：1.文件夹；2.文件 例如：1:23|1:45|2:78|2:632 |
| `collectCode` | `string` | — | 收集任务code，文件收集功能专用 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 计算指定用户的文件权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/CalculateFilePerm`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件ID |
| `userUniqueIdentity` | `string` | ✅ | 用户唯一标识，支持用户guid和登录账号，字符最大长度100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 计算指定用户的历史版本权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/CalculateFileVerPerm`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件ID |
| `userUniqueIdentity` | `string` | ✅ | 用户唯一标识，支持用户guid和登录账号，字符最大长度100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 计算用户文件夹权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/CalculateFolderPerm`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹ID |
| `userUniqueIdentity` | `string` | ✅ | 用户唯一标识，支持用户guid和登录账号，字符最大长度100 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量查询多个文件夹的权限阻断状态

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderBlock/GetFolderBlockStatus`

> 批量查询多个文件夹的权限阻断状态

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderIds` | `array[integer(int32)]` | ✅ | 文件夹编号集合 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 查询指定文件夹是否已设置权限阻断

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/FolderBlock/IsFolderBlocked`

> 查询指定文件夹是否已设置权限阻断（内存查询，无数据库访问）

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 取消文件夹权限阻断

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderBlock/RemoveFolderBlock`

> 取消文件夹权限阻断，恢复继承父文件夹权限

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置文件夹权限阻断

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderBlock/SetFolderBlock`

> 设置文件夹权限阻断，阻断后子文件夹不再继承父文件夹权限

<details>
<summary><b>Request Body  (请求参数，包含文件夹ID和可选的管理员成员列表)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 目标文件夹 ID |
| `adminMembers` | `array[object]` | — | 同时分配管理权限的目标成员列表（可选，不传或传空均视为不分配） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置文件权限(包含增改)

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/AddFilePermission`

> 请勿对接权限到每个文件，超过限制系统将无法使用

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件ID |
| `permissions` | `array[object]` | — | 文件权限列表 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置文件夹权限(包含增改)

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/AddFolderPermission`

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | — | 文件夹ID |
| `permissions` | `array[object]` | — | 权限列表 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 清除指定文件所有权限，但不包括继承权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/ClearPermissionByFile`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 清除指定文件夹所有权限，但不包括继承权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/ClearPermissionByFolder`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除文件权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/DeleteFilePermission`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件ID |
| `mermbers` | `array[object]` | — | 权限成员集合 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除文件夹权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/DeleteFolderPermission`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹ID |
| `mermbers` | `array[object]` | — | 权限成员集合 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件权限类别

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/GetFilePermCates`

> 适用于企业内容库文件夹权限设置

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 令牌 |
| `lang` | ❓ query | `string` | — | 多语言，默认是中文(zh-cn) * zh-cn 简体中文 * en 英文 |
| `returnPermValues` | ❓ query | `boolean` | — | 是否返回权限类别对应的详细的权限值（默认不返回） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件夹权限分类列表

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/GetFolderPermCates`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ |  |
| `lang` | ❓ query | `string` | ✅ |  |
| `returnPermValues` | ❓ query | `boolean` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据ID获取权限分类

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/GetPermCateById`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ |  |
| `cateId` | ❓ query | `integer(int32)` | ✅ |  |
| `lang` | ❓ query | `string` | ✅ |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取团队文件夹权限分类列表

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/GetTeamFolderPermCates`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ |  |
| `lang` | ❓ query | `string` | ✅ |  |
| `returnPermValues` | ❓ query | `boolean` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件权限列表

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/LoadFilePermission`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `fileId` | ❓ query | `integer(int64)` | ✅ | 文件ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件夹权限列表

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/LoadFolderPermission`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ | 用户凭证 |
| `folderId` | ❓ query | `integer(int32)` | ✅ | 文件夹ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置文件权限（包含增删改）

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/NewSetFilePermission`

> 请勿对接权限到每个文件，超过限制系统将无法使用

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件ID |
| `newPermissions` | `array[object]` | — | 新增权限记录 |
| `changePermissions` | `array[object]` | — | 修改权限记录 |
| `deletePermissions` | `array[object]` | — | 删除权限记录 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置文件夹权限（包含增删改）

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/PermList/NewSetFolderPermission`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | — | 文件夹ID |
| `newPermissions` | `array[object]` | — | 新增权限记录 |
| `changePermissions` | `array[object]` | — | 修改权限记录 |
| `deletePermissions` | `array[object]` | — | 删除权限记录 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 元数据

### 创建元数据类型

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/CreateMetaType`

<details>
<summary><b>Request Body  (参数示例： {"typeName":"测试创建元数据类型","typeDescription":"","folderId":"22"})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验权限，需要有文件夹管理权限 |
| `typeName` | `string` | ✅ | 元数据类型名称 |
| `typeDescription` | `string` | — | 元数据类型描述 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 新增元数据类型字段

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/CreateMetaTypeAttr`

<details>
<summary><b>Request Body  (参数示例，需要转义后传入 例如：{"folderId":22,"typeId":"250312142642","assemblyData":"{\"Id\":\"\",\"Name\":\"文本框\",\"ControlId\":\"\",\"Type\":\"text\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":255,\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\"}"} 其他类型仅assemblyData字段值不同，其他类型assemblyData示例： 数值："{\"Id\":\"\",\"Name\":\"数值\",\"ControlId\":\"\",\"Type\":\"number\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":\"12\",\"Length\":\"0\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\"}" 复选框："{\"Id\":\"\",\"Name\":\"复选框\",\"ControlId\":\"\",\"Type\":\"switch\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"true\",\"DateFormat\":\"\",\"FieldLength\":\"\",\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"\",\"DataOnText\":\"开\",\"DataOffText\":\"关\",\"ShowItemValue\":\"\",\"Placeholder\":\"\"}" 单选下拉："{\"Id\":\"1741761818291\",\"Name\":\"单选下拉\",\"ControlId\":\"\",\"Type\":\"dropdown\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":\"\",\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"[{\\\"value\\\":1741761808250,\\\"text\\\":\\\"选项1\\\",\\\"extprop\\\":\\\"%7B%22color%22:%22#ffdbea%22,%22isDark%22:1,%22key%22:1741761808250%7D\\\"},{\\\"value\\\":1741761808497,\\\"text\\\":\\\"选项2\\\",\\\"extprop\\\":\\\"%7B%22color%22:%22#ffb5b3%22,%22isDark%22:1,%22key%22:1741761808497%7D\\\"}]\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"singleSelectbox\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\"}" 成员："{\"Id\":\"\",\"Name\":\"成员\",\"ControlId\":\"\",\"Type\":\"member\",\"DefaultValueType\":\"\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":\"\",\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"true\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"AllowUser\",\"Placeholder\":\"\"}" 文本域："{\"Id\":\"\",\"Name\":\"文本域\",\"ControlId\":\"\",\"Type\":\"textArea\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":\"\",\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\",\"Height\":80}" 文件选择："{\"Id\":\"\",\"Name\":\"文件选择\",\"ControlId\":\"\",\"Type\":\"fileSelect\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":\"\",\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"false\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\",\"TopFolderIds\":\"[{\\\"id\\\":1,\\\"name\\\":\\\"企业内容库\\\",\\\"folderId\\\":1,\\\"folderName\\\":\\\"企业内容库\\\"}]\"}" 文件夹选择："{\"Id\":\"\",\"Name\":\"文件夹选择\",\"ControlId\":\"\",\"Type\":\"folderSelect\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":\"\",\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"false\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\",\"TopFolderIds\":\"[{\\\"id\\\":1,\\\"name\\\":\\\"企业内容库\\\",\\\"folderId\\\":1,\\\"folderName\\\":\\\"企业内容库\\\"}]\"}")</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类型id |
| `assemblyData` | `string` | ✅ | 新增的元数据字段字符串 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验是否有文件夹操作权限，需要有管理权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量新增元数据类型字段

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/CreateMetaTypeAttrList`

<details>
<summary><b>Request Body  (参数示例，需要转义后传入 例如：{"folderId":22,"typeId":"250312142642","assemblyData":"[{\"Id\":\"\",\"Name\":\"文本框\",\"ControlId\":\"\",\"Type\":\"text\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":255,\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\"}]"})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类型id |
| `assemblyData` | `string` | ✅ | 新增的元数据字段字符串 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验是否有文件夹操作权限，需要有管理权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除文档元数据

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/DeleteEntityMetaMapEx`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `string` | ✅ | 元数据关联id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除元数据类型

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/DeleteMetaType`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类型id |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验是否有文件夹操作权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除元数据类型字段

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/DeleteMetaTypeAttr`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类型id |
| `id` | `string` | ✅ | 元数据字段id,ControllModel属性的id字段 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验是否有文件夹操作权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取批量更新进度

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetDocumentInfoProgress`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `progressId` | `string` | ✅ | 进度id，通过UpdateDocumentInfoBatch接口获取 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文档策略元数据

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetEntityAndMetaMapForBatch`

> 只返回元数据记录id值，具体字段值需要通过GetMetaTypeRecord接口获取

<details>
<summary><b>Request Body  (参数示例： {"entityType":"2","entityIds":"37","fileVerIds":"1","operateType":"manage"})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `entityIds` | `string` | ✅ | 文档ids，多个以,分隔 |
| `entityType` | `string` | ✅ | 文档类型，1：文件夹，2：文件 |
| `isFillMetaAttr` | `string` | — | 是否获取元数据类别属性列表 |
| `operateType` | `string` | ✅ | 操作类型，“view”：只读，“setting”：编辑，只获取文档自身元数据，“manage”：编辑，会获取策略值 |
| `metaMapId` | `string` | — | 元数据关联id，OperateType为“setting”传值才有用 |
| `metaStrategy` | `integer(int32)` | — | 元数据策略类型，0：文档自身元数据，1：文件夹策略元数据，2：文件策略元数据 |
| `fileVerIds` | `string` | — | 版本id，未开启版本元数据不传 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文档自身绑定元数据

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFileMetaTypeAndFirst`

> 只返回元数据记录id值以及第一个元数据字段值信息，其余具体字段值需要通过GetFileMetaTypeRecord接口获取

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | ✅ | 文件夹或者文件id |
| `fileType` | `integer(int32)` | ✅ | 文档类型，1：文件夹，2：文件 |
| `fileVerId` | `integer(int64)` | — | 版本id，仅开启版本元数据时传递 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取指定元数据记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetFileMetaTypeRecord`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `metaTypeId` | `string` | ✅ | 类别id |
| `metaRecordId` | `string` | ✅ | 元数据记录id 动态生成的元数据表 metadata_xxx 的id |
| `lang` | `string` | — | 多语言 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取元数据字段列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetMetaAttrList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类型id |
| `lang` | `string` | — | 多语言，zh-cn、en |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `attrId` | `string` | 属性ID |
| `attrName` | `string` | 属性名称 |
| `attrValue` | `string` | 属性值 |
| `controlModel` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取元数据类型列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetMetaTypeList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `isFillMetaAttr` | `boolean` | — | 是否获取元数据属性列表，默认false，不传表示不获取属性列表 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK — 返回类型：`string`
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件夹策略或文档自身绑定元数据具体值

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetMetaTypeRecord`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `mapId` | `string` | ✅ | 元数据关联id 查文档自身元数据 时传(dms_entiymetamap)表的Id 查文件夹策略元数据时传(flat_dms_entiymetamap)表的Id |
| `metaStrategy` | `integer(int32)` | ✅ | 0:文档自身元数据，1：文件夹策略元数据 |
| `lang` | `string` | — | 多语言语言,zh-cn、en |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 更新单个文档元数据

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/UpdateEntityMetaMapEx`

<details>
<summary><b>Request Body  (参数示例： 新增参数示例：{"entityType":"1","entityId":"24","metaStrategy":"1","metaTypeId":"250312142642","recordId":"7389afd5-392c-4109-aae1-d59d9e5a7264","mapId":"c4ce854a-caef-4a58-8e23-fea5370d4e75","dataSet":"entityType=1|entityId=24|metaStrategy=1|text20250312143413618=%E7%AD%96%E7%95%A5%E9%BB%98%E8%AE%A4%E5%80%BC|number20250312144250663=|switch20250312144306130=1|date20250312144257884=|dropdown20250312144327006_h=|dropdown20250312144327006=|fileSelect20250312144353895_h=|fileSelect20250312144353895=%5B%5D|folderSelect20250312144407291_h=|folderSelect20250312144407291=%5B%5D","formVer":"","formId":"250312142642"} 修改参数示例：{"entityType":"1","entityId":"24","metaStrategy":"1","metaTypeId":"250312142642","recordId":"7389afd5-392c-4109-aae1-d59d9e5a7264","mapId":"c4ce854a-caef-4a58-8e23-fea5370d4e75","dataSet":"Id=7389afd5-392c-4109-aae1-d59d9e5a7264|entityType=1|entityId=24|metaStrategy=1|text20250312143413618=%E7%AD%96%E7%95%A5%E9%BB%98%E8%AE%A4%E5%80%BC%E4%BF%AE%E6%94%B9|number20250312144250663=|switch20250312144306130=1|date20250312144257884=|member20250312144334520_h=|member20250312144334520=%5B%5D|dropdown20250312144327006_h=|dropdown20250312144327006=|textArea20250312144340988=|fileSelect20250312144353895_h=|fileSelect20250312144353895=%5B%5D|folderSelect20250312144407291_h=|folderSelect20250312144407291=%5B%5D","formVer":"","formId":"250312142642"})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `entityId` | `integer(int64)` | ✅ | 文档id |
| `entityType` | `integer(int32)` | ✅ | 文档类型 |
| `metaStrategy` | `integer(int32)` | ✅ | 元数据策略类型，0：文档自身元数据，1：文件夹策略元数据 |
| `formId` | `string` | — | 元数据类型id（表单id） |
| `formVer` | `string` | — | 元数据类型版本（表单版本） |
| `recordId` | `string` | — | 元数据记录id，唯一主键（新增元数据：随机GUID；更新元数据：获取文件元数据接口返回的metaRecordId） |
| `dataSet` | `string` | — | 此参数说明： 1、属性key,value拼接的方式传递； 2、属性key，value不能有多余空格，“=”、“|”两边不能有多余空格；（key是表属性，value是表属性值，有空格会导致错误） 3、添加和修改时EntityId（文件或者文件夹id）、EntityType(类型1：文件夹、2：文件)、metaStrategy，单个属性必传 4、修改时必须传递i |
| `mapId` | `string` | — | 元数据关联id，唯一主键（新增元数据：随机GUID；更新元数据：获取文件元数据接口返回的MapId） |
| `metaTypeId` | `string` | — | 元数据类型id(表单id) |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改元数据字段顺序

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/UpdateMetaAttrSort`

<details>
<summary><b>Request Body  (参数示例： {"typeId":"250312142642","attrIds":["text20250312143413618","number20250312144250663","switch20250312144306130","date20250312144257884","member20250312144334520","dropdown20250312144327006","textArea20250312144340988","fileSelect20250312144353895","folderSelect20250312144407291"],"folderId":22})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | — | 元数据类型id |
| `attrIds` | `array[string]` | ✅ | 新的元数据字段顺序，按照集合中存储的顺序保存 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验是否有文件夹操作权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改元数据类型

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/UpdateMetaType`

<details>
<summary><b>Request Body  (参数示例： {"typeName":"测试修改元数据类型","typeDescription":"","folderId":"22","typeId":"250312142642"})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验权限，需要有文件夹管理权限 |
| `typeId` | `string` | ✅ | 元数据类型id |
| `typeName` | `string` | ✅ | 元数据类型名称 |
| `typeDescription` | `string` | — | 元数据类型描述 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改元数据类型字段

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/UpdateMetaTypeAttr`

<details>
<summary><b>Request Body  (参数示例： 修改时需要携带Id，且每种控件仅支持部分属性修改，文本框参数示例： {"folderId":22,"typeId":"250312142642","assemblyData":"{\"Id\":\"1157718d-00ec-4b28-ba90-dfea6509ef74\",\"Name\":\"文本框修改\",\"ControlId\":\"text20250312143413618\",\"Type\":\"text\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":255,\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\"}"} 可修改通用字段：Name（名称）、Placeholder（提示文字） 控件可修改特有字段 文本：FieldLength（最大字符串，仅支持更改的小于创建时传递的值，因为字段一旦创建，对应的数据库字段长度已经确定了且后续不再修改） 数值：MaxValue（最大值）、MinValue（最小值） 日期：DateFormat（日期格式） 复选：DataOnText（打开显示文本）、DataOffText（关闭显示文本） 下拉：Mode（模式，singleSelectbox 单选、multipleSelectbox 多选）、Datasource（选项） 成员：ShowItemValue（标签栏位） 文本域：Height（高度） 文件选择：Mode（false 单选、true 多选）、TopFolderIds（顶级文件夹） 文件夹选择：Mode（false 单选、true 多选）、TopFolderIds（顶级文件夹）)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类别id |
| `assemblyData` | `string` | ✅ | 修改的元数据字段字符串 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验是否有文件夹操作权限，需要有文件夹管理权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量修改元数据类型字段

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/UpdateMetaTypeAttrList`

<details>
<summary><b>Request Body  (参数示例： 修改时需要携带Id，且每种控件仅支持部分属性修改，文本框参数示例： {"folderId":22,"typeId":"250312142642","assemblyData":"[{\"Id\":\"1157718d-00ec-4b28-ba90-dfea6509ef74\",\"Name\":\"文本框修改\",\"ControlId\":\"text20250312143413618\",\"Type\":\"text\",\"DefaultValueType\":\"userVar\",\"DefaultValue\":\"\",\"DateFormat\":\"\",\"FieldLength\":255,\"Length\":\"\",\"InlineUnit\":\"\",\"Datasource\":\"\",\"MaxValue\":\"\",\"MinValue\":\"\",\"Mode\":\"\",\"DataOnText\":\"\",\"DataOffText\":\"\",\"ShowItemValue\":\"\",\"Placeholder\":\"\"}]"} 可修改通用字段：Name（名称）、Placeholder（提示文字） 控件可修改特有字段 文本：FieldLength（最大字符串，仅支持更改的小于创建时传递的值，因为字段一旦创建，对应的数据库字段长度已经确定了且后续不再修改） 数值：MaxValue（最大值）、MinValue（最小值） 日期：DateFormat（日期格式） 复选：DataOnText（打开显示文本）、DataOffText（关闭显示文本） 下拉：Mode（模式，singleSelectbox 单选、multipleSelectbox 多选）、Datasource（选项） 成员：ShowItemValue（标签栏位） 文本域：Height（高度） 文件选择：Mode（false 单选、true 多选）、TopFolderIds（顶级文件夹） 文件夹选择：Mode（false 单选、true 多选）、TopFolderIds（顶级文件夹）)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类别id |
| `assemblyData` | `string` | ✅ | 修改的元数据字段字符串 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id，用于校验是否有文件夹操作权限，需要有文件夹管理权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 更新元数据类型状态

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/UpdateMetaTypeStatus`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类型id |
| `status` | `integer(int32)` | ✅ | 更新的状态，运行变更的情况: 启用-->暂停,暂停-->启用,暂停-->删除 * 0 启用 * 1 停用 * 2 删除 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除文件夹元数据策略

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaData/DeleteMetaObjTypeAndMap`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `objType` | `string` | ✅ | 策略类型，固定传9 |
| `objId` | `string` | ✅ | 文件夹id |
| `metaType` | `string` | ✅ | 元数据类型id |
| `metaMapId` | `string` | — | 默认值记录关联id，非必传 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件夹元数据策略

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaData/GetFldMetaTypesAndAttr`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `objType` | `string` | ✅ | 策略类型，固定传9 |
| `fldId` | `string` | ✅ | 文件夹id |
| `isFillMetaAttr` | `string` | ✅ | 是否填充元数据属性 "true"、"false" |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据文档 ID 获取文档自身元数据记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaData/GetMetaTypeRecordByDocId`

> 根据文档ID获取文档自身元数据记录

<details>
<summary><b>Request Body  (参数示例： {"docId":"1","docType":2,"operateType":"view","typeId":""})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `docId` | `string` | ✅ | 文档 ID，支持 guid 和自增 ID。 |
| `docType` | `integer(int32)` | ✅ | 文档类型，1：文件夹，2：文件。 |
| `operateType` | `string` | — | 操作类型，view：查看，manage：编辑。编辑会返回控件信息，view则只返回数据不会返回控件信息 |
| `typeId` | `string` | — | 元数据类型 ID，可为空。 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 绑定文件夹元数据策略

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaData/UpadeteMetaObjTypeAndMap`

<details>
<summary><b>Request Body  (给文件夹设置元数据策略时必须先执行此接口给文件夹绑定元数据策略，然后执行UpdateSysFolderMetaDataVer5（设置元数据策略是否继承和强制必填）给文件夹设置是否继承和强制必填。 参数示例： {"objType":"9","objId":"23","metaType":"250311155857"})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `objType` | `string` | ✅ | 策略类型，固定传9 |
| `objId` | `string` | ✅ | 文件夹id |
| `metaType` | `string` | ✅ | 类别id，可为空，设置为空目的是为了打断继承 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量更新文档元数据

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaData/UpdateDocumentInfoBatch`

<details>
<summary><b>Request Body  (参数示例，需要转义后传入 参数示例：{"data":"[{\"docId\":37,\"docType\":2,\"changeColumns\":[{\"columnName\":\"basic:name\",\"columnValue\":\"111.docx\"},{\"columnName\":\"basic:code\",\"columnValue\":\"\"},{\"columnName\":\"basic:remark\",\"columnValue\":\"\"},{\"columnName\":\"basic:securityLevel\",\"columnValue\":\"\"},{\"columnName\":\"meta:250312142642-edoc2Textbox\\\\text20250312143413618\\\\文本框修改\",\"columnValue\":\"11\"},{\"columnName\":\"meta:250312142642-edoc2Number\\\\number20250312144250663\\\\数值\",\"columnValue\":\"11\"},{\"columnName\":\"meta:250312142642-edoc2Switch\\\\switch20250312144306130\\\\复选框\",\"columnValue\":\"1\"},{\"columnName\":\"meta:250312142642-edoc2Date\\\\date20250312144257884\\\\日期\",\"columnValue\":\"2025-03-12\"},{\"columnName\":\"meta:250312142642-edoc2SelectMember\\\\member20250312144334520_h\\\\成员\",\"columnValue\":\"test1\"},{\"columnName\":\"meta:250312142642-edoc2SelectMember\\\\member20250312144334520\\\\成员\",\"columnValue\":\"%5B%7B%22id%22%3A%22db95e13f557247f192cf4eb5142f4c68%22%2C%22guid%22%3A%22db95e13f557247f192cf4eb5142f4c68%22%2C%22text%22%3A%22test1%22%2C%22memberType%22%3A0%2C%22identityId%22%3A23%7D%5D\"},{\"columnName\":\"meta:250312142642-edoc2Selectbox\\\\dropdown20250312144327006_h\\\\单选下拉\",\"columnValue\":\"%E9%80%89%E9%A1%B91\"},{\"columnName\":\"meta:250312142642-edoc2Selectbox\\\\dropdown20250312144327006\\\\单选下拉\",\"columnValue\":\"1741761808250\"},{\"columnName\":\"meta:250312142642-edoc2TextArea\\\\textArea20250312144340988\\\\文本域\",\"columnValue\":\"11\"},{\"columnName\":\"meta:250312142642-edoc2SelectFile\\\\fileSelect20250312144353895_h\\\\文件选择\",\"columnValue\":\"%E6%97%A0%E6%A0%87%E9%A2%98%E6%96%87%E6%A1%A3.docx\"},{\"columnName\":\"meta:250312142642-edoc2SelectFile\\\\fileSelect20250312144353895\\\\文件选择\",\"columnValue\":\"%5B%7B%22fileId%22%3A27%2C%22fileName%22%3A%22%E6%97%A0%E6%A0%87%E9%A2%98%E6%96%87%E6%A1%A3.docx%22%7D%5D\"},{\"columnName\":\"meta:250312142642-edoc2SelectFolder\\\\folderSelect20250312144407291_h\\\\文件夹选择\",\"columnValue\":\"11\"},{\"columnName\":\"meta:250312142642-edoc2SelectFolder\\\\folderSelect20250312144407291\\\\文件夹选择\",\"columnValue\":\"%5B%7B%22folderId%22%3A14%2C%22folderName%22%3A%2211%22%7D%5D\"}]}]"} 字段说明 columnName: [basic:{fieldName}|meta:{typeId}-{controlType}\\{attrId}\\{attrName}] columnValue: 修改后的值，需使用encodeURIComponent编码)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `data` | `string` | ✅ | 请求参数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** **返回结果示例：**
```
{
    "result":0,
    "msg":"",
    "data":"76869c1ed9f74a778bbff154943bc65f"
}
```
注意：接口返回成功不表示更新成功，需要拿data的guid去接口GetDocumentInfoProgress请求查看更新结果

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 更新文档单个元数据(同步接口)

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaData/UpdateMetaDataInfo`

<details>
<summary><b>Request Body  (参数示例，需要转义后传入 参数示例：{"token":"0000e75252ce6ce040b0a0354236630dfb4c","data":"{\"docId\":27,\"docType\":2,\"changeColumns\":[{\"columnName\":\"meta:251128143119-edoc2Textbox\\\\WB1\\\\文本1\",\"columnValue\":\"1\"}]}"} 字段说明 columnName: meta:{typeId}-{controlType}\\{attrId}\\{attrName} columnValue: 修改后的值，需使用encodeURIComponent编码)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `data` | `string` | ✅ | 请求参数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** **返回结果示例：**
```
{
    "result":0,
    "msg":"",
    "data":""
}
```

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置元数据策略是否继承和强制必填

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaData/UpdateSysFolderMetaDataVer5`

> 修改背景：修复 Swagger 中 UpdateSysFolderMetaDataVer5 接口不显示标题，原参数示例包含 XML 文档不支持的控制字符。 修改人：haiwei.cui 修改时间：2026-06-17 修改内容：将参数示例中的实际控制字符替换为 \u0004 文本表示，保证 XML 注释可被 Swagger 解析。

<details>
<summary><b>Request Body  (执行此接口前必须先执行UpadeteMetaObjTypeAndMap（修改文件夹元数据策略）给文件夹绑定元数据策略，否侧会导致元数据策略绑定不上，同时会产生脏数据 就算指定元数据策略删除重置脏数据也无法清理，需要手动删掉flat_dms_entitymetamap 对应文件夹的脏数据才可以 参数示例： {"objType":"9","fldId":24,"blUpdateStrategy":"1","isInherit":"0","strMeta":"250312142642\u0004测试修改元数据类型\u00048\u00044"})</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `objType` | `string` | ✅ | 策略类型，固定传9 |
| `fldId` | `integer(int32)` | ✅ | 文件夹id |
| `blUpdateStrategy` | `string` | ✅ | 固定传1 |
| `isInherit` | `string` | ✅ | 固定传0 |
| `strMeta` | `string` | ✅ | 策略字符串， 字符串拼接格式为 {typeId}\u0004{typeName}\u0004[0|8]\u0004[0|4] 以\u0004分隔，含义分别为元数据类型id、元数据类型名称、是否强制必填（0或8）、是否继承（0或4） 示例，设置强制必填不继承传递"250311155857\u0004测试元数据类型名称\u00048\u00040" 是否强制必填 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取指定模型结构

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaModel/GetMetaModelInfoByName`

> 获取指定模型结构

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `appId` | `string` | — | 应用 AppId |
| `modelName` | `string` | ✅ | 模型名称（ModelName） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取所有模型列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaModel/GetMetaModelList`

> 获取所有模型列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `appId` | `string` | — | 应用 AppId |
| `moduleKey` | `string` | — | 模块标识（ModelKey） |
| `searchModelName` | `string` | — | 模糊查询模型名称 |
| `pageIndex` | `integer(int32)` | — | 当前页码（从 1 开始） |
| `pageSize` | `integer(int32)` | — | 每页条数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 查询元数据模型列表数据

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MetaModel/SearchMetaModelData`

> 查询元数据模型列表数据

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `typeId` | `string` | ✅ | 元数据类型 TypeId |
| `attrId` | `string` | ✅ | 元数据字段 AttrId |
| `keyword` | `string` | — | 模糊查询关键词 |
| `pageIndex` | `integer(int32)` | — | 当前页码（从 1 开始） |
| `pageSize` | `integer(int32)` | — | 每页条数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 流程

### 根据Key获取流程策略

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocList/GetProcessStrategyByKey`

> 获取指定文件（夹）文控流程策略

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `entryType` | `integer(int32)` | ✅ | 文档类型（1.文件夹；2.文件） |
| `entryId` | `integer(int64)` | ✅ | 文件（夹）id |
| `isFilterStarter` | `boolean` | — | 是否过滤发起人（默认true，验证当前用户是否在流程发起人范围内；传false时不验证当前用户在流程发起人范围内，一般展示策略时传false） |
| `isFilterState` | `boolean` | — | 是否过滤流程状态，true时返回已发布的状态，下架、删除等其他状态的不返回 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 导航

### 获取文库导航列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocNav/GetFlatDocNavList`

> 获取文库左侧导航列表（获取常用列表）

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ |  |
| `navNavType` | ❓ query | `integer(int32)` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 文档操作

### 复制单个文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocOperation/CopySingleFile`

> 业务说明： 1. 调用方通过 FileId 指定待复制文件，通过 TargetFolderId 指定目标文件夹。 2. 目标文件夹不能是团队顶级目录，否则接口返回错误结果并保留空文件信息对象。 3. 接口会根据 Token 获取当前用户身份，并调用底层复制能力创建新文件。 4. 复制成功后会将新文件的权限、版本、扩展名、大小、路径、密级等字段映射到 SDK 输出对象。 5. 若底层复制服务未返回新文件对象，接口按无权限复制处理，并返回底层业务结果码。 返回差异说明：该接口面向单文件复制，返回 CopySingleFileDto，Data 是复制后新文件详情；Operation.CopyFolderFiles 面向批量复制，返回 MoveFolderFilesDtoSDK，Data 是任务信息 FileState 和 Ptaskid。

<details>
<summary><b>Request Body  (单文件复制请求参数。Token 为用户凭证；FileId 为待复制文件 ID；TargetFolderId 为目标文件夹 ID。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `targetFolderId` | `integer(int32)` | ✅ | 目标文件夹id |
| `fileId` | `integer(int64)` | ✅ | 文件id 默认复制元数据 复制权限 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 删除文件与文件夹，支持普通文档删除、专辑内删除和文件收集场景删除。（用于需要返回删除的文件夹 ID 集合 Folders、文件 ID 集合 Files 的业务）

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocOperation/DeleteFolderAndFiles`

> 业务说明： 1. 普通删除场景：调用方传入 Folders、Files 后，系统会按当前 SDK Token 对应用户身份删除指定文件夹和文件。 2. 专辑删除场景：调用方传入 FvIds 时，删除文档的同时会配合业务服务处理专辑收藏关系。 3. 文件收集场景：调用方传入 CollectCode 时，删除前会校验收集任务状态、有效期以及待删除数据是否属于当前收集用户提交范围。 4. 异步删除场景：IsAsync 为 true 时，接口会返回 PTaskid，调用方可通过进度查询接口获取后台删除进度和错误信息。 5. 兼容说明：该 SDK 接口内部复用 Operation 模块统一删除能力，并将 Operation 返回的文件、文件夹和任务编号映射为 SDK 输出对象。 返回差异说明：该接口与 Operation.DeleteFolderFiles 复用同一删除能力，Data 字段内容一致，均包含 Folders、Files 和 PTaskid；

<details>
<summary><b>Request Body  (删除请求参数。Folders 为文件夹 ID 集合，Files 为文件 ID 集合，多个 ID 使用英文逗号分隔；FvIds 用于专辑删除；CollectCode 用于文件收集删除；IsAsync 控制是否异步执行。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folders` | `string` | — | 文件夹Ids 多个以英文逗号分隔，例如"30,31" |
| `files` | `string` | — | 文件ids 多个以英文逗号分隔，例如"30,31" |
| `fvIds` | `string` | — | 从专辑删除，则传收藏文件、文件夹的ID |
| `collectCode` | `string` | — | 收集任务code，收集页中调用删除必传 |
| `remark` | `string` | — | 备注 |
| `isAsync` | `boolean` | — | 是否异步 默认为true |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 删除文件与文件夹。（普通删除）

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocOperation/DeleteFolderFiles`

> 业务说明： 1. 调用方至少需要在 FileIdList 或 FolderIdList 中传入一个待删除对象，否则接口返回参数错误。 2. 删除前会根据 Token 获取当前用户身份，并检查当前用户是否因频繁删除触发删除限制。 3. 删除文件前会校验文件是否存在、是否已删除、是否处于本地编辑或在线编辑状态，避免删除不可操作文件。 4. Async 为 true 时执行后台异步删除，Data 返回 ptaskid，调用方可通过进度查询接口查看删除进度和错误信息。 5. Async 为 false 时执行同步删除，接口会在删除操作完成后返回业务结果码。 返回差异说明：该接口返回 ResultValue，Data 主要是 ptaskid 或提示文本；Operation.DeleteFolderFiles 和 DocOperation.DeleteFolderAndFiles 返回删除任务 DTO，Data 包含 Folders、Files 和 PTaskid。

<details>
<summary><b>Request Body  (普通删除请求参数。FileIdList 为文件 ID 数组，FolderIdList 为文件夹 ID 数组；Async 控制同步或异步删除。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIdList` | `array[integer(int64)]` | — | 文件id列表(无值为空数组[]) 最大数组长度100,如需更大场景请自行分批次调用 FileIdList 和 FolderIdList 至少有一个参数有值 |
| `folderIdList` | `array[integer(int32)]` | — | 文件夹id列表(无值为空数组[]) 最大数组长度100,如需更大场景请自行分批次调用 FileIdList 和 FolderIdList 至少有一个参数有值 |
| `async` | `boolean` | — | 是否异步执行 异步执行:文件会在后台执行删除,不会立即删除,可以通过`GetProgressByTaskId`获取进度和错误 非异步执行:会在文件完全删除后,才返回响应消息 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 获取异步任务进度。

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/DocOperation/GetProgress`

> 业务说明： 1. taskId 为异步移动、异步删除等接口返回的后台任务编号 ptaskid。 2. 接口会调用 DocOperation 进度查询服务获取任务进度 JSON 字符串。 3. 返回的 Data 字段由底层进度服务生成，调用方可按业务约定解析任务状态、进度和错误信息。 修改背景：旧GetProgressByTaskId接口废弃后，需要提供统一的进度查询入口。 修改人：yingshuai.wang 修改时间：2026-06-10 修改内容：新增GetProgress接口，复用DocOperation进度查询能力。

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | — | 用户凭证。当前实现保留该参数用于统一 SDK 接口签名。 |
| `taskId` | ❓ query | `string` | — | 异步任务 ID，即异步操作返回的 ptaskid。 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 剪切文件与文件夹。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocOperation/MoveFolderListAndFileList`

> 业务说明： 1. 调用方通过 FileIdList 和 FolderIdList 指定待移动的文件和文件夹，TargetFolderId 指定目标文件夹。 2. 目标文件夹不能是团队顶级目录，且必须存在、未删除，否则接口返回对应错误码。 3. 移动文件前会校验文件是否存在，以及是否处于本地编辑或在线编辑状态，避免移动不可操作文件。 4. Async 为 true 时执行异步移动，Data 返回 ptaskid，调用方可通过进度查询接口获取后台任务进度。 5. IsSkipProcessStrategyVerify 用于控制是否跳过流程策略校验，实际校验由底层移动服务处理。 返回差异说明：该接口返回 ResultValue，异步时 Data 仅为 ptaskid；Operation.MoveFolderFiles 返回 ResultValue，Data 同时包含 FileState 和 Ptaskid。

<details>
<summary><b>Request Body  (移动请求参数。Token 为用户凭证；FileIdList 为待移动文件 ID 数组；FolderIdList 为待移动文件夹 ID 数组；TargetFolderId 为目标文件夹 ID；Async 控制同步或异步移动。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `targetFolderId` | `integer(int32)` | ✅ | 目标文件夹id |
| `fileIdList` | `array[integer(int64)]` | — | 文件id列表 |
| `folderIdList` | `array[integer(int32)]` | — | 文件夹id列表 |
| `async` | `boolean` | — | 是否异步执行 异步执行:文件会在后台进行剪切,用于通过GetProgress查询进度和错误 非异步执行:会在文件剪切完成之后再响应消息 |
| `isSkipProcessStrategyVerify` | `boolean` | — | 是否跳过流程策略验证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 复制文件夹文件。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationCopy/CopyFolderFiles`

> 业务说明： 1. 调用方通过 strFolderIds 和 strFileIds 指定待复制文件夹和文件，多个 ID 使用英文逗号分隔。 2. strDestFolderId 为目标文件夹 ID，是执行复制操作的必填参数。 3. shareId 用于复制共享文件或共享文件夹数据时传递共享上下文。 4. 接口将 SDK 入参映射为 Operation 模块入参，并复用 Operation 模块的文件夹文件复制能力。 5. 返回 Data 中的 Ptaskid 可用于后续查询后台任务进度，FileState 用于标识相关文件状态。 返回差异说明：该接口面向批量复制，返回的是任务信息 MoveFolderFilesDtoSDK；DocOperation.CopySingleFile 面向单文件复制，返回的是复制后新文件的完整详情 CopySingleFileDto。

<details>
<summary><b>Request Body  (复制请求参数。strFolderIds 为待复制文件夹 ID 集合；strFileIds 为待复制文件 ID 集合；strDestFolderId 为目标文件夹 ID；shareId 为共享 ID。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `strFolderIds` | `string` | — | 文件夹ids,多个以英文逗号分隔，例如"30,31",与strFileIds二选一必填。 |
| `strFileIds` | `string` | — | 文件ids,多个以英文逗号分隔，例如"30,31", 与strFolderIds二选一必填。 |
| `strDestFolderId` | `string` | ✅ | 目标文件夹,int类型文件夹id |
| `shareId` | `integer(int32)` | — | 共享Id （需要复制共享的文件或文件夹数据时 共享ID 需要获取共享id） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取复制子项数量。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationCopy/GetCopyChildCount`

> 业务说明： 1. 调用方通过 FolderIds 和 FileIds 指定待复制对象，多个 ID 使用英文逗号分隔。 2. ShareId 用于共享数据复制场景，RootName 用于协作库等特殊根目录场景。 3. 接口将 SDK 入参映射为 Operation 模块入参，并复用 Operation 模块的复制子项统计能力。 4. 返回的子项数量用于前端或外部系统展示复制范围，不直接执行复制动作。

<details>
<summary><b>Request Body  (复制子项统计请求参数。FolderIds 为文件夹 ID 集合；FileIds 为文件 ID 集合；ShareId 为共享 ID；RootName 为根目录标识。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderIds` | `string` | — | 文件夹Ids 多个以英文逗号分隔，例如"30,31" |
| `fileIds` | `string` | — | 文件ids 多个以英文逗号分隔，例如"30,31" |
| `shareId` | `string` | — | 共享Id |
| `rootName` | `string` | — | 根目录 协作库需要传：Collaboration 其他库不需要传 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取删除子项数量。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationDelete/GetDeleteChildCount`

> 业务说明： 1. 调用方通过 FolderIds 和 FileIds 指定待删除对象，多个 ID 使用英文逗号分隔。 2. CollectCode 用于文件收集场景，收集页发起删除统计时需要传入。 3. 接口将 SDK 入参映射为 Operation 模块入参，并复用 Operation 模块的删除子项统计能力。 4. 返回的子项数量用于前端或外部系统展示删除影响范围，不直接执行删除动作。

<details>
<summary><b>Request Body  (删除子项统计请求参数。FolderIds 为文件夹 ID 集合；FileIds 为文件 ID 集合；CollectCode 为收集任务编码。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderIds` | `string` | — | 文件夹Ids ,多个以英文逗号分隔，例如"30,31" |
| `fileIds` | `string` | — | 文件ids ,多个以英文逗号分隔，例如"30,31" |
| `collectCode` | `string` | — | 收集任务code，收集页中调用删除必传 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取移动子项数量。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationMove/GetMoveChildCount`

> 业务说明： 1. 调用方通过 FolderIds 和 FileIds 指定待移动对象，多个 ID 使用英文逗号分隔。 2. 接口将 SDK 入参映射为 Operation 模块入参，并复用 Operation 模块的移动子项统计能力。 3. 返回的子项数量用于前端或外部系统展示移动影响范围，不直接执行移动动作。

<details>
<summary><b>Request Body  (移动子项统计请求参数。FolderIds 为文件夹 ID 集合；FileIds 为文件 ID 集合。)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderIds` | `string` | — | 文件夹Ids,多个以英文逗号分隔，例如"30,31" |
| `fileIds` | `string` | — | 文件ids,多个以英文逗号分隔，例如"30,31" |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 视图

### 删除入口文档视图

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocView/DeleteEntryDocView`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `entryId` | `string` | ✅ | 文件夹id |
| `viewId` | `integer(int32)` | ✅ | 视图id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取入口文档视图

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocView/GetEntryDocView`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `entryId` | `string` | ✅ | 文件夹id，支持传参file_id和file_guid |
| `viewId` | `integer(int32)` | ✅ | 视图id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置文档视图置顶

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocView/SetDocViewTop`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `entryId` | `string` | ✅ | 文件夹id，支持传参file_id和file_guid |
| `viewId` | `integer(int32)` | ✅ | 视图id |
| `isTop` | `boolean` | ✅ | 是否置顶，默认:false |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置入口文档视图

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/DocView/SetEntryDocView`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `entryId` | `string` | ✅ | 文件夹id |
| `viewId` | `integer(int32)` | — | 视图id |
| `viewName` | `string` | ✅ | 视图名称 |
| `configString` | `string` | ✅ | 配置信息 可参考页面新增编辑传参方式 示例： basic:name800basic:editor200basic:size200basic:version200basic:code200basic:creator200basic:createTime200basic:state200basic:remark200basic:securityLevel200m |
| `isDefault` | `boolean` | — | 是否默认，默认值false |
| `isInherit` | `boolean` | — | 是否继承，默认值false |
| `xmlCfg` | `string` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 新增导航记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ViewNav/CreateNav`

> 新增导航记录

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `string` | ✅ | 文件夹id，支持传参 folder_id 和 folder_guid |
| `navName` | `string` | ✅ | 导航名称 |
| `navUrl` | `string` | ✅ | 导航链接 |
| `navIcon` | `string` | — | 导航图标 |
| `openType` | `integer(int32)` | — | 打开方式（0：右侧预览；1：新窗口；2：当前窗口），默认0 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除导航记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ViewNav/DeleteNav`

> 删除导航记录

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `integer(int32)` | ✅ | 主键id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件夹导航列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ViewNav/GetNavList`

> 获取文件夹导航列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `string` | ✅ | 文件夹id，支持传参 folder_id 和 folder_guid |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置导航记录排序（按 ids 顺序重新赋值）

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ViewNav/SetNavSort`

> 设置导航记录排序

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `string` | ✅ | 文件夹id，支持传参 folder_id 和 folder_guid |
| `ids` | `array[integer(int32)]` | ✅ | 导航记录主键id列表，按期望的排序顺序传入， 系统将按列表索引（从1开始）依次更新各记录的 Sort 值 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 修改导航记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ViewNav/UpdateNav`

> 修改导航记录

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `id` | `integer(int32)` | ✅ | 主键id |
| `navName` | `string` | ✅ | 导航名称 |
| `navUrl` | `string` | ✅ | 导航链接 |
| `navIcon` | `string` | — | 导航图标 |
| `openType` | `integer(int32)` | — | 打开方式（0：右侧预览；1：新窗口；2：当前窗口） |
| `sort` | `integer(int32)` | — | 排序 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 文件夹助手

### 删除文件夹助手设置

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderAgent/DelFolderAgentSetting`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id |
| `settingId` | `integer(int32)` | ✅ | 设置id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取助手列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderAgent/GetAgentList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `searchContent` | `string` | — | 搜索关键字，可为空 |
| `pageIndex` | `integer(int32)` | — | 分页查询参数， |
| `pageSize` | `integer(int32)` | — | 分页查询参数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件夹助手设置

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderAgent/GetFolderAgentSetting`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id |
| `scope` | `integer(int32)` | — | 生效范围 0：全部，1：文件夹，2：文件 |
| `isGetAvatar` | `boolean` | — | 是否获取Agent图标，默认false |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 批量更新文件夹助手

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderAgent/UpdateFolderAgentBatch`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `list` | `array[object]` | — | 批量更新 |
| `folderId` | `integer(int32)` | — | 文件夹id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 新增或更新文件夹助手设置

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderAgent/UpsertFolderAgentSetting`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `data` | `object` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 通知

### 根据文件夹ID获取通知配置

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderNotify/GetFolderNotifyByFolderId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置通知

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/FolderNotify/SetNotify`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | — | 文件夹id |
| `deleteNotifyIds` | `string` | — | 删除的通知 |
| `addOrUpdateNotifysData` | `string` | — | 新增和更新的通知 传入json 如 [{"NotifyMsgTypes":"301,401,339,403,305,404,405,332,304,325,303,402,338","NotifyType":5,"NotifyRecursive":true,"NotifyName":"test","NotifyMember":[{"NotifyMemberI |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 团队

### 移除邀请成员

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Invite/DeleteInviteUser`

> 移除邀请成员

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队ID |
| `inviteIds` | `array[integer(int32)]` | ✅ | 移除邀请成员记录ID的集合 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取指定团队的邀请列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Invite/GetInviteUsers`

> 获取指定团队的邀请列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队ID |
| `keyword` | `string` | — | 搜索关键词，仅支持外部成员账号搜索 |
| `sortName` | `string` | — | 排序字段，支持createtime |
| `desc` | `boolean` | — | 排序方式 |
| `pageIndex` | `integer(int32)` | — | 页码 |
| `pageSize` | `integer(int32)` | — | 每页条数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
| `total` | `integer(int64)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取邀请地址和邮箱、短信配置开启

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Invite/GetTeamInviteCfg`

> 获取邀请地址和邮箱、短信配置开启

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队编号 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 邀请协作

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Invite/TeamInvite`

> 邀请协作

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队ID |
| `type` | `integer(int32)` | ✅ | 验证类型(1. 短信验证；2.邮箱验证) |
| `accounts` | `string` | ✅ | 手机号/邮箱，多个使用英文逗号分割 |
| `permCateId` | `integer(int32)` | ✅ | 权限类别ID: 13 下载；14 编辑；15 管理 |
| `url` | `string` | — | 邀请链接，referer的域名与环境域名一致时可以不传，不一致时必传 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 邀请协作的团队验证

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Invite/VerifyTeam`

> 邀请协作的团队验证

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `guid` | `string` | ✅ | 团队库文件夹guid，邀请链接中的et参数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 新建团队

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/CreateTeam`

> 新建团队

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamName` | `string` | ✅ | 团队名称 |
| `teamIcon` | `string` | — | 头像字符串 |
| `teamRemark` | `string` | — | 备注 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 判断是否是团队管理成员

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/CreateTeamPermission`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `boolean` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 解散团队

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/DeleteTeam`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 团队文件夹Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 移除团队成员

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/DeleteTeamUserByUserIds`

> 使用场景：成员管理

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |
| `userIds` | `string` | ✅ | 要移除的团队成员 用户ids |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 编辑团队

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/EditTeamInfo`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |
| `folderId` | `integer(int32)` | — | 团队文件夹id |
| `teamName` | `string` | ✅ | 新的团队名称 |
| `teamIcon` | `string` | — | 团队头像的base64数据字符串，为空则不修改头像 |
| `teamRemark` | `string` | — | 备注 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 移交团队

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/EditTeamOwner`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |
| `userId` | `integer(int32)` | ✅ | 移交对象Id，id是指identityId |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取团队库列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/GetMyTeamList`

> 获取团队信息

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageNum` | `integer(int32)` | — | 页索引`起始页从1开始`，默认为第1页 |
| `pageSize` | `integer(int32)` | — | 每页大小`(范围 1-100)`，默认每页大小为30 |
| `sortName` | `string` | — | 排序字段，必须为team_name、team_createTime、team_remark，为空或其它值时系统会默认使用team_name |
| `teamType` | `integer(int32)` | ✅ | 团队类型 0 表示和我有关的所有的团队，1：我的置顶团队，2:我创建的团队，3：我参与的(非我创建的) |
| `desc` | `boolean` | — | 是否降序排序，为空则为正序 |
| `keyWord` | `string` | — | 团队库名称关键字 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据团队Id获取团队信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/GetTeamById`

> 根据团队Id获取团队信息

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据团队文件夹id获取团队信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/GetTeamInfoByFolderId`

> 根据团队文件夹id获取团队信息

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 团队文件夹Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `pfolderId` | `integer(int32)` | 团队库根目录id |
| `team` | `object` |  |
| `teamUser` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取团队库可移交成员列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/GetTeamOverUserList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹Id |
| `lang` | `string` | — | 多语言(zh-cn、zh-tw、ja、en) 默认zh-cn |
| `checkUserIcon` | `string` | — | 是否检查用户头像|非必填 true|false |
| `pageNum` | `integer(int32)` | ✅ | 页索引`起始页从1开始`，为空默认为第1页 |
| `pageSize` | `integer(int32)` | ✅ | 每页大小`(范围 1-100)`，为空默认每页大小为30 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据团队id获取团队用户列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/GetTeamUserByTeamIdPaging`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageNum` | `integer(int32)` | ✅ | 页索引`起始页从1开始`，为空默认为第1页 |
| `pageSize` | `integer(int32)` | ✅ | 每页大小`(范围 1-100)`，为空默认每页大小为30 |
| `totalCount` | `integer(int32)` | — | 总数 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据团队文件夹Id获取团队成员列表（分页）

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/GetTeamUserList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹Id |
| `lang` | `string` | — | 多语言(zh-cn、zh-tw、ja、en) 默认zh-cn |
| `checkUserIcon` | `string` | — | 是否检查用户头像|非必填 true|false |
| `pageNum` | `integer(int32)` | ✅ | 页索引`起始页从1开始`，为空默认为第1页 |
| `pageSize` | `integer(int32)` | ✅ | 每页大小`(范围 1-100)`，为空默认每页大小为30 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 退出团队

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/QuitTeam`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 成员管理新增/编辑成员列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/SaveTeamUserList`

> 使用场景：成员管理

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |
| `addUserInfo` | `array[integer(int32)]` | — | 新增的团队成员 用户uerIdentityIds |
| `updateUserInfo` | `array[object]` | — | 更新的团队成员 |
| `deleteUserInfo` | `array[integer(int32)]` | — | 删除的团队成员 用户uerIdentityIds |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 设置团队成员类型

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/SetTeamUserRole`

> 使用场景：成员管理

<details>
<summary><b>Request Body  (数据传输对象)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `userIds` | `array[integer(int32)]` | ✅ | 用户Id列表 最大支持100个 |
| `userType` | `integer(int32)` | ✅ | 用户成员类型,2:管理员,3:内部人员,4:外部人员 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 置顶团队

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/StickTeam`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 取消置顶团队

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Team/UnStickTeam`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `teamId` | `integer(int32)` | ✅ | 团队Id |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## KM

### 获取知识库列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/km/PageList`

> 获取知识列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `categoryGuid` | `string` | — | 知识库分类 guid |
| `keyWord` | `string` | — | 搜索知识库名 |
| `includeTopBox` | `boolean` | — | 是否包含置顶的知识库 |
| `pageNumber` | `integer(int32)` | — |  |
| `pageSize` | `integer(int32)` | — |  |
| `sortField` | `string` | — | 排序字段，默认为空 ，不排序 |
| `isAsc` | `boolean` | — | 排序方式 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
| `total` | `integer(int64)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## LOGO

### 获取系统Logo图片地址

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/Logo/ImgUrls`

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 外发

### 取消我的所有过期外发

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyOutgoing/CancelMyAllStalePublic`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageNum` | `integer(int32)` | ✅ | 页码 | int | 必传 |
| `pageSize` | `integer(int32)` | ✅ | 每页显示数量 | int | 必传 |
| `desc` | `boolean` | — | 是否降序 |
| `feild` | `string` | — | 排序字段 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |

</details>

---

### 取消外发

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyOutgoing/CancelPublish`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileCodeList` | `string` | — | 文件外发code，多个以‘|’分隔|string|可选 |
| `folderCodeList` | `string` | — | 文件夹外发code，多个以‘|’分隔|string|可选 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |

</details>

---

### 修改文件外发

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyOutgoing/ChangeFilePublish`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 外发code|string|必填 |
| `endTime` | `string` | ✅ | 外发过期时间|datetime|必填 |
| `publishUrl` | `string` | — | 外发链接 |
| `name` | `string` | ✅ | 外发名称|string|必填 |
| `password` | `string` | — | 外发密码|string|可选 |
| `authType` | `integer(int32)` | ✅ | 是否有密码，1：无密码外发；2：有密码外发|int|必填 |
| `remark` | `string` | — | 外发备注|string|可选 |
| `canDownload` | `boolean` | ✅ | 是否可下载|bool|必填 |
| `canDownloadPdf` | `boolean` | — | 是否可下载pdf |
| `canEdit` | `boolean` | ✅ | 是否可更新版本|bool|必填 |
| `canOnlineEdit` | `boolean` | — | 是否可在线编辑 |
| `canpreviewTime` | `boolean` | — | 是否设置预览次数|bool|可选 |
| `previewTimes` | `integer(int32)` | — | 预览次数|int|可选 |
| `canSetDownloadTime` | `boolean` | — | 是否设置下载次数|bool|可选 |
| `downloadTime` | `integer(int32)` | — | 下载次数|int|可选 |
| `publishValidate` | `integer(int32)` | — | 外发接收验证 0：无须验证 1：邮箱验证 2：手机验证|int|可选|默认0 |
| `watermarkType` | `integer(int32)` | — | 水印设置 0：跟随文件目录 1：自定义水印|int|可选|默认0 |
| `watermarkCfg` | `string` | — | 水印内容 |
| `publishFileVerType` | `integer(int32)` | — | 文件版本设置 0：保持最新版本 1：固定当前版本|int|可选|默认0 |
| `backgroundId` | `integer(int32)` | — | 外发背景 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |

</details>

---

### 修改文件夹外发

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyOutgoing/ChangeFolderPublish`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 外发code|string|必填 |
| `endTime` | `string` | ✅ | 外发过期时间|datetime|必填 |
| `name` | `string` | ✅ | 外发名称|string|必填 |
| `password` | `string` | — | 外发密码|string|可选 |
| `publishUrl` | `string` | — | 外发链接 |
| `canDownload` | `boolean` | ✅ | 是否可下载|bool|必填 |
| `canEdit` | `boolean` | ✅ | 是否可更新版本|bool|必填 |
| `canUpload` | `boolean` | — | 是否可下载 |
| `downloadpdf` | `boolean` | — | 是否可pdf下载 |
| `canOnlineEdit` | `boolean` | — | 是否可在线编辑 |
| `publishState` | `integer(int32)` | — | 是否发起流程 0:不发起流程 1:发起流程|int|可选 |
| `remark` | `string` | — | 外发备注|string|可选 |
| `canSetDownloadTime` | `boolean` | — | 是否设置下载次数|bool|可选 |
| `downloadTime` | `integer(int32)` | — | 下载次数|int|可选 |
| `authType` | `integer(int32)` | ✅ | 是否有密码，1：无密码外发；2：有密码外发|int|必填 |
| `publishValidate` | `integer(int32)` | — | 外发接收验证 0：无须验证 1：邮箱验证 2：手机验证|int|可选|默认0 |
| `watermarkType` | `integer(int32)` | — | 水印设置 0：跟随文件目录 1：自定义水印|int|可选|默认0 |
| `watermarkCfg` | `string` | — | 水印内容 |
| `publishFileVerType` | `integer(int32)` | — | 文件版本设置 0：保持最新版本 1：固定当前版本|int|可选|默认0 |
| `backgroundId` | `integer(int32)` | — | 外发背景 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |

</details>

---

### 获取密码策略

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyOutgoing/GetPasswordStrategy`

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取外发文件文件夹排序列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyOutgoing/GetPublishFilesFoldersSort`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `sortField` | `string` | — | 排序字段 | string |
| `sortDesc` | `boolean` | — | 是否降序 | bool |
| `pageNum` | `integer(int32)` | ✅ | 页码 | int | 必传 |
| `pageSize` | `integer(int32)` | ✅ | 每页显示数量 | int | 必传 |
| `keyWord` | `string` | — | 搜索内容（外发名称）| string | 为null或空则查询全部 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 按条件加载操作日志

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyOutgoing/LoadLogOperationByCondition`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageNum` | `integer(int32)` | ✅ | 页码 | int | 必传 |
| `pageSize` | `integer(int32)` | ✅ | 每页显示数量 | int | 必传 |
| `isExport` | `boolean` | — | 是否导出（默认不到处） |
| `destName` | `string` | — | 发布编号|string|非必传 |
| `isPublish` | `string` | — |  |
| `userIdArray` | `string` | — | 操作人编号|int|非必传 |
| `optSourceName` | `string` | — | 文件夹名称|string|非必传 |
| `optSourceParentName` | `string` | — | 父级文件夹名称|string|非必传 |
| `optType` | `string` | — | 操作类型(以逗号分隔)|string|非必传 |
| `objType` | `string` | — |  |
| `optSourceId` | `string` | — | 文件夹编号|int|非必传 |
| `userRealName` | `string` | — | 操作人真实名称|string|非必传 |
| `messageFrom` | `string` | — |  |
| `lang` | `string` | — | 语言(zh-cn,zh-tw,en,ja)|string| |
| `optTimeEnd` | `string` | — |  |
| `optTimeStart` | `string` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 绑定固定当前外发文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OutPublish/BindingFixedCurPubilshFile`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIdList` | `string` | ✅ | 外发文件列表，多个以‘,’分隔|string|必填 |
| `endTime` | `string` | ✅ | 外发过期时间|datetime|必填 |
| `outpublishName` | `string` | ✅ | 外发名称|string|必填 |
| `outpublishPwd` | `string` | — | 外发密码|string|可选,当外发类型为有密码外发强制非空并满足密码策略 密码 可通过GetPublishPwd 接口获取 |
| `outpublishRemark` | `string` | — | 外发备注|string|可选 |
| `outpublishAuthType` | `string` | ✅ | 是否有密码，1：无密码外发；2：有密码外发|string|必填 |
| `canDownload` | `boolean` | ✅ | 是否可下载|bool|必填 |
| `canEdit` | `boolean` | ✅ | 是否可更新版本|bool|必填 |
| `canDownloadPdf` | `boolean` | — | 是否可pdf下载|bool|必填 |
| `canOnlineEdit` | `boolean` | — | 是否可在线编辑 |
| `canpreviewTime` | `boolean` | — | 是否设置预览次数|bool|可选 |
| `previewTimes` | `string` | — | 预览次数|int|可选 |
| `canSetDownloadTime` | `boolean` | — | 是否设置下载次数|bool|可选 |
| `downloadTime` | `string` | — | 下载次数|int|可选 |
| `publishValidate` | `integer(int32)` | — | 外发接收验证 0：无须验证 1：邮箱验证 2：手机验证|int|可选|默认0 |
| `watermarkType` | `integer(int32)` | — | 水印设置 0：跟随文件目录 1：自定义水印 2 无水印 |int|可选|默认0 |
| `watermarkCfg` | `string` | — | 水印内容 |
| `publishFileVerType` | `integer(int32)` | — | 文件版本设置 0：保持最新版本 1：固定当前版本|int|可选|默认0 |
| `backgroundId` | `integer(int32)` | — | 外发背景 |
| `emailLimitList` | `string` | — | 邮箱限定列表，以,分割 |
| `mobileLimitList` | `string` | — | 手机限定列表，以,分割 |
| `publishCode` | `string` | ✅ | CreateFolderPublishAsync 接口返回 PublishCode |
| `publishTargetFolderId` | `string` | ✅ | 固定当前版本 返回的文件夹Id CreateFolderPublishAsync 接口返回 PublishTargetFolderId |
| `permission` | `integer(int32)` | — | CreateFolderPublishAsync 接口返回 Permission |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 绑定固定当前外发文件夹

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OutPublish/BindingFixedCurPubilshFolder`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderIdList` | `string` | ✅ | 外发文件列表，多个以‘,’分隔|string|必填 |
| `endTime` | `string` | ✅ | 外发过期时间|datetime|必填 |
| `outpublishPwd` | `string` | — | 外发密码|string|可选 密码 可通过GetPublishPwd 接口获取 |
| `outpublishRemark` | `string` | — | 外发备注|string|可选 |
| `outpublishAuthType` | `integer(int32)` | ✅ | 是否有密码，1：无密码外发；2：有密码外发|int|必填 |
| `outpublishName` | `string` | — | 外发名称 |
| `canDownload` | `boolean` | ✅ | 是否可下载|bool|必填 |
| `canEdit` | `boolean` | ✅ | 是否可更新版本|bool|必填 |
| `canUpload` | `boolean` | ✅ | 是否可上传|bool|必填 |
| `canOnlineEdit` | `boolean` | — | 是否可在线编辑 |
| `canSetDownloadTime` | `boolean` | — | 是否设置下载次数|bool|可选 |
| `downloadTime` | `integer(int32)` | — | 下载次数|int|可选 |
| `publishValidate` | `integer(int32)` | — | 外发接收验证 0：无须验证 1：邮箱验证 2：手机验证|int|可选|默认0 |
| `watermarkType` | `integer(int32)` | — | 水印设置 0：跟随文件目录 1：自定义水印 2 无水印 |int|可选|默认0 |
| `watermarkCfg` | `string` | — | 水印内容 |
| `publishFileVerType` | `integer(int32)` | — | 文件版本设置 0：保持最新版本 1：固定当前版本|int|可选|默认0 |
| `backgroundId` | `integer(int32)` | — | 外发背景 |
| `emailLimitList` | `string` | — | 邮箱限定列表，以,分割 |
| `mobileLimitList` | `string` | — | 手机限定列表，以,分割 |
| `publishCode` | `string` | — | CreateFolderPublishAsync 接口返回 PublishCode |
| `publishTargetFolderId` | `string` | — | 固定当前版本 返回的文件夹Id CreateFolderPublishAsync 接口返回 PublishTargetFolderId |
| `permission` | `integer(int32)` | — | CreateFolderPublishAsync 接口返回 Permission |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 创建文件外发

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OutPublish/CreateFilePublish`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIdList` | `string` | ✅ | 外发文件列表，多个以‘,’分隔|string|必填 |
| `endTime` | `string` | ✅ | 外发过期时间|datetime|必填 |
| `outpublishName` | `string` | ✅ | 外发名称|string|必填 |
| `outpublishPwd` | `string` | — | 外发密码|string|可选,当外发类型为有密码外发强制非空并满足密码策略 密码 可通过GetPublishPwd 接口获取 |
| `outpublishRemark` | `string` | — | 外发备注|string|可选 |
| `outpublishAuthType` | `string` | ✅ | 是否有密码，1：无密码外发；2：有密码外发|string|必填 |
| `canDownload` | `boolean` | ✅ | 是否可下载|bool|必填 |
| `canEdit` | `boolean` | ✅ | 是否可更新版本|bool|必填 |
| `canDownloadPdf` | `boolean` | — | 是否可pdf下载|bool|必填 |
| `canOnlineEdit` | `boolean` | — | 是否可在线编辑 |
| `canpreviewTime` | `boolean` | — | 是否设置预览次数|bool|可选 |
| `previewTimes` | `string` | — | 预览次数|int|可选 |
| `canSetDownloadTime` | `boolean` | — | 是否设置下载次数|bool|可选 |
| `downloadTime` | `string` | — | 下载次数|int|可选 |
| `publishValidate` | `integer(int32)` | — | 外发接收验证 0：无须验证 1：邮箱验证 2：手机验证|int|可选|默认0 |
| `watermarkType` | `integer(int32)` | — | 水印设置 0：跟随文件目录 1：自定义水印 2 无水印 |int|可选|默认0 |
| `watermarkCfg` | `string` | — | 水印内容 |
| `publishFileVerType` | `integer(int32)` | — | 文件版本设置 0：保持最新版本 1：固定当前版本|int|可选|默认0 |
| `backgroundId` | `integer(int32)` | — | 外发背景 |
| `emailLimitList` | `string` | — | 邮箱限定列表，以,分割 |
| `mobileLimitList` | `string` | — | 手机限定列表，以,分割 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 创建文件夹外发

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OutPublish/CreateFolderPublish`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderIdList` | `string` | ✅ | 外发文件列表，多个以‘,’分隔|string|必填 |
| `endTime` | `string` | ✅ | 外发过期时间|datetime|必填 |
| `outpublishPwd` | `string` | — | 外发密码|string|可选 密码 可通过GetPublishPwd 接口获取 |
| `outpublishRemark` | `string` | — | 外发备注|string|可选 |
| `outpublishAuthType` | `integer(int32)` | ✅ | 是否有密码，1：无密码外发；2：有密码外发|int|必填 |
| `outpublishName` | `string` | — | 外发名称 |
| `canDownload` | `boolean` | ✅ | 是否可下载|bool|必填 |
| `canEdit` | `boolean` | ✅ | 是否可更新版本|bool|必填 |
| `canUpload` | `boolean` | ✅ | 是否可上传|bool|必填 |
| `canOnlineEdit` | `boolean` | — | 是否可在线编辑 |
| `canSetDownloadTime` | `boolean` | — | 是否设置下载次数|bool|可选 |
| `downloadTime` | `integer(int32)` | — | 下载次数|int|可选 |
| `publishValidate` | `integer(int32)` | — | 外发接收验证 0：无须验证 1：邮箱验证 2：手机验证|int|可选|默认0 |
| `watermarkType` | `integer(int32)` | — | 水印设置 0：跟随文件目录 1：自定义水印 2 无水印 |int|可选|默认0 |
| `watermarkCfg` | `string` | — | 水印内容 |
| `publishFileVerType` | `integer(int32)` | — | 文件版本设置 0：保持最新版本 1：固定当前版本|int|可选|默认0 |
| `backgroundId` | `integer(int32)` | — | 外发背景 |
| `emailLimitList` | `string` | — | 邮箱限定列表，以,分割 |
| `mobileLimitList` | `string` | — | 手机限定列表，以,分割 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取背景列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OutPublish/GetBackgroundList`

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |

</details>

---

### 获取邮件和短信设置

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OutPublish/GetEmailAndSmsSetting`

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取外发有效期

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OutPublish/GetPublishEffectiveTime`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `isShow` | `boolean` | — | 是否是外部展示，默认true)|bool|非必传 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取外发密码

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/OutPublish/GetPublishPwd`

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>


## 共享

### 删除所有过期共享

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyShare/DeleteAllExpiredShare`

<details>
<summary><b>Request Body  (删除所有过期共享输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |

</details>

---

### 删除所有共享

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Share/DeleteAllShare`

<details>
<summary><b>Request Body  (删除所有共享输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `shareIds` | `string` | ✅ | 共享id，多个以‘,’分隔|string|必填 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |

</details>

---

### 根据共享ID获取文档

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Share/GetDocByShareId`

<details>
<summary><b>Request Body  (获取共享文档输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `shareId` | `integer(int32)` | ✅ | 共享id|int|必填 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取我的共享

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Share/GetMyShare`

<details>
<summary><b>Request Body  (获取我的共享输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageNum` | `integer(int32)` | ✅ | 页|int|必填 |
| `pageSize` | `integer(int32)` | — | 条数|int|可选 |
| `sort` | `boolean` | — | 是否正序排序|bool|可选，默认是false |
| `sortField` | `string` | — | 排序字段|string|可选 |
| `keyWord` | `string` | — | 搜索内容|string|为null或空查询全部 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 获取共享有效时间

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Share/GetShareEffectiveTime`

<details>
<summary><b>Request Body  (获取共享有效时间输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `isShow` | `boolean` | — | 是否是外部展示，默认true)|bool|非必传 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 保存共享

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Share/SaveShare`

<details>
<summary><b>Request Body  (保存共享输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `shareId` | `integer(int32)` | ✅ | 共享id|int|必填,新增填-1 ，编辑传共享Id |
| `dateType` | `string` | ✅ | 共享有效时间设置类型 | string | 必填 SpecifyTime 指定具体结束时间，end传结束时间，days无需传值 Ordinary 指定设置的天数，days传设置几天，end无需传值 Permanent 为永久有效，days和end都无需传值 |
| `days` | `string` | — | 过期天数 |
| `member` | `string` | ✅ | 共享给|string|必填 【共享目标，目标类型】目标类型：用户 0，用户组 3，职位4，部门5， 例如 [28,0;29,0] |
| `shareName` | `string` | ✅ | 共享名称|string|必填 |
| `sendMail` | `boolean` | ✅ | 是否邮件通知|bool|必填 |
| `power` | `integer(int32)` | ✅ | 共享权限|int|必填 0 预览 4 预览+打印 7 下载 编辑 15 |
| `begin` | `string` | ✅ | 有效期|datetime|必填 |
| `end` | `string` | — | 有效期|datetime| |
| `entrys` | `string` | ✅ | 共享列表，【文档Id,文档类型】，多个以‘;’分割，每组以‘,’分隔|string|必填，文档类型 1表示文件夹；2表示文件 参数示例 25,2;30,2 共享了文件Id25和文件Id30 单次共享只能是单纯的文件或者文件夹；不能文件夹文件同时共享 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>

---

### 根据共享ID分页获取文档

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ShareToMe/GetDocByShareIdPage`

<details>
<summary><b>Request Body  (分页获取共享文档输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `shareId` | `integer(int32)` | ✅ | 共享id|int|必填 |
| `pageSize` | `integer(int32)` | ✅ | 页|int|必填 |
| `pageNum` | `integer(int32)` | ✅ | 条数|int|必填 |
| `sortOrder` | `string` | — | 排序字段|string|必填 |
| `isMyShare` | `boolean` | — | 是否是我的共享|bool|可选 |
| `sortDesc` | `boolean` | — | 是否是正序排序|bool|可选 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 根据用户ID获取置顶共享文件列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ShareToMe/GetTopShareFileByUserIdList`

<details>
<summary><b>Request Body  (获取置顶共享文件输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `uid` | `integer(int32)` | — | 用户id|int|可选 如果不传该值表示查询共享给我的所有记录，如果传入某个用户id表示查询这个用户共享给我的记录 |
| `field` | `string` | — | 排序字段|string|可选 |
| `desc` | `boolean` | — | 是否倒序|bool|可选 |
| `pageNum` | `integer(int32)` | ✅ | 页|int|必填 |
| `pageSize` | `integer(int32)` | ✅ | 条数|int|必填 |
| `summary` | `boolean` | — | 是否统计子文件和文件夹个数|bool|可选 |
| `keyWord` | `string` | — | 搜索内容|string|为null或空查询全部 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 搜索用户名

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/ShareToMe/GetUserNameSearch`

<details>
<summary><b>Request Body  (搜索用户名输入参数)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `topNum` | `integer(int32)` | ✅ | 搜索5个 |
| `likeUserName` | `string` | — | 搜索是传模糊用户名，不传查所有 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |

</details>


## 最近

### 最近列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyVisit/GetMyRecentlyList`

> 最近列表

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageNum` | `integer(int32)` | — | 页码 |
| `pageSize` | `integer(int32)` | — | 每页显示的数量 |
| `dateType` | `string` | — | 操作时间(7-d:一周内，1-m:最近一个月，3-m:最近三个月，为空代表全部) |
| `searchValue` | `string` | — | 文件名模糊搜索 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |

</details>

---

### 移除最近访问记录

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/MyVisit/RemoveRecently`

> 移除最近访问记录

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `recentlyIds` | `array[integer(int32)]` | — | 最近访问IDS |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |

</details>


## 任务中心

### 删除操作任务

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationTaskHub/DeleteTask`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `operationId` | `integer(int32)` | ✅ | 任务ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文档操作持久化信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationTaskHub/GetDocOperationPersistentInfo`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `operationId` | `integer(int32)` | — | 任务ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据任务ID获取文档操作持久化信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationTaskHub/GetDocOperationPersistentInfoByTaskId`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `taskId` | `string` | — | 任务ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文档操作持久化任务列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationTaskHub/GetDocOperationPersistentTaskList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `operationPersistentType` | `integer(int32)` | ✅ | 操作类型：1.删除至回收站,2.删除至二级回收站，3.二级回收站彻底删除，4.二级回收站还原，5.还原至文档库，6.复制，7.移动, -1.全部 |
| `operationState` | `integer(int32)` | ✅ | 当前状态：0未处理, 1处理中，2已完成，3失败,-1全部 |
| `operationOperatorId` | `integer(int32)` | ✅ | 操作人 :-1 全部 |
| `isSystemManagement` | `boolean` | ✅ | 是否系统管理，默认值：false |
| `beginTime` | `string` | ✅ | 开始时间 |
| `endTime` | `string` | ✅ | 结束时间 |
| `orderField` | `string` | — | 排序类型，默认任务创建时间 |
| `desc` | `boolean` | — | 是否倒序，默认倒序 |
| `pageIndex` | `integer(int32)` | ✅ | 当前页 |
| `pageSize` | `integer(int32)` | ✅ | 每页行数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 重试操作任务

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationTaskHub/RetryTask`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `operationId` | `integer(int32)` | ✅ | 任务ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 停止操作任务

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OperationTaskHub/StopTask`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `operationId` | `integer(int32)` | ✅ | 任务ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 外网外发

### 创建直接外网文件发布

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OuterNetPublish/CreateDirectOuterNetFilePublish`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileIdList` | `string` | ✅ | 外发文件列表，多个以‘,’分隔|string|必填 |
| `endTime` | `string(date-time)` | ✅ | 外发过期时间 |
| `outpublishName` | `string` | ✅ | 外发名称 |
| `outpublishPwd` | `string` | — | 外发密码:当外发类型为有密码外发强制非空并满足密码策略 |
| `outpublishRemark` | `string` | — | 外发备注 |
| `outpublishAuthType` | `integer(int32)` | ✅ | 外发类型，0：无密码外发；1：有密码外发 |
| `canDownload` | `boolean` | ✅ | 是否可下载 |
| `canDownloadPdf` | `boolean` | ✅ | 是否可以导出PDF |
| `canEdit` | `boolean` | ✅ | 是否可编辑 |
| `canPreviewTime` | `boolean` | — | 是否设置预览次数 |
| `previewTimes` | `integer(int32)` | — | 预览次数 |
| `canSetDownloadTime` | `boolean` | — | 是否设置下载次数 |
| `downloadTime` | `integer(int32)` | — | 下载次数 |
| `unionId` | `string` | — | 联邦ID |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取外网发布密码策略

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OuterNetPublish/GetOutNetPublishPasswordStrategy`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取外网发布密码

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/OuterNetPublish/GetOutNetPublishPwd`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 用户模块

### 创建或修改快捷入口信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/QuickNav/CreateOrModifyQuickInfo`

<details>
<summary><b>Request Body</b></summary>



</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取快捷入口列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/QuickNav/GetQuickNavList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 回收站

### 检查团队文档管理员权限

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RecycleBin/CheckTeamDocManagerPermission`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `path` | `string` | ✅ | 文件夹路径 团队库顶级+团队库文件夹id 例如7\\41 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 检查用户是否管理员

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RecycleBin/CheckUserAdmin`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 清空文件夹文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RecycleBin/ClearFolderFiles`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folders` | `string` | — | 文件夹id 文件夹id集合，用逗号隔开 Folders 和Files 必须至少传一个 |
| `files` | `string` | — | 文件id ，文件id集合，用逗号隔开 |
| `msgSource` | `integer(int32)` | — | 文档操作日志细分 默认0 |
| `code` | `string` | — | 共享外发时 token占位符 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 清空回收站所有文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RecycleBin/ClearRecycleBinAll`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `path` | `string` | — | 文件夹路径 企业库 1 团队库 7\\团队库文件夹Id 例如7\\40 个人库 2\\当前人个人库Id 例如2\\10 知识库 9\\知识库文件夹id 例如9\\42 协作库 6\\协作库id 例如6\\43 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取协作文件夹

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RecycleBin/GetCollaborationFolder`

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取删除文件夹大小和子项数量

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RecycleBin/GetDeleteFolderSizeChildCount`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `path` | `string` | ✅ | 文件夹路径 |
| `folderId` | `string` | — | 文件夹id 多选逗号分隔 |
| `recalculate` | `boolean` | — | 是否重新计算 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 加载分页回收站文档

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/RecycleBin/LoadPagedDocRecycle`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageNum` | `integer(int32)` | — | 页码 |
| `pageSize` | `integer(int32)` | — | 分页大小 |
| `orderField` | `string` | — | 排序列 |
| `orderDesc` | `boolean` | — | 排序类型 |
| `keyWord` | `string` | — | 查询参数 |
| `startDate` | `string(date-time)` | ✅ | 开始时间 |
| `endDate` | `string(date-time)` | ✅ | 结束时间 |
| `createUserId` | `string` | — | 创建人 |
| `deleteUserId` | `string` | — | 删除人 |
| `path` | `string` | ✅ | 文件夹路径 企业库 1 团队库 7\\团队库文件夹Id 例如7\\40 个人库 2\\当前人个人库Id 例如2\\10 知识库 9\\知识库文件夹id 例如9\\42 协作库 6\\协作库文件夹id 例如6\\43 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 恢复文件夹文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Restore/RestoreFolderFiles`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folders` | `string` | — | 文件夹id 文件夹id集合，用逗号隔开 Folders 和Files 必须至少传一个 |
| `files` | `string` | — | 文件id ，文件id集合，用逗号隔开 |
| `destFolderId` | `integer(int32)` | — | 目标文件夹id:不传还原到原文件夹，如果原文件夹不存在则必传 |
| `msgSource` | `integer(int32)` | — | 消息来源 默认8 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 搜索

### 获取搜索数据（统一搜索入口） SearchWhere 为非必填参数，当不传时权限范围由 FileSearchType 自动决定； folderId/folderPath 由 SDK 根据 FileSearchType 自动绑定。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Search/GetSearchData`

<details>
<summary><b>Request Body  (搜索参数，详见 SearchDataInput 属性说明)</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageIndex` | `integer(int32)` | — | 页码 默认1 `起始页从1开始` |
| `pageSize` | `integer(int32)` | — | 页面大小，默认20 `(范围 1-100)` |
| `indexName` | `string` | — | 索引库名称 默认file,可选值： * file * folder |
| `keyWord` | `string` | ✅ | 关键字 KeyWord只作用于文件名、文件标签、文件内容、文件夹名。如果只想搜元数据，KeyWord传*，元数据的条件需要在searchWhere中实现 |
| `searchWhere` | `string` | — | 高级搜索条件（可选），ES query string 格式。 根据 FileSearchType 补充权限路径条件，防止传入的 folderId/folderPath 与实际搜索类型不匹配导致数据越界 具体查询条件字段要根据你输入的IndexName 去查看对应索引库的字段名,以下以file索引字段为例: ``` ---------------------- |
| `searchFields` | `string` | — | 搜索字段多个以逗号分割，若SearchFields设置了字段则KeyWord匹配指定字段的字段值，若无则匹配所有字段值 默认：filename,filetag 表示搜索文件名，标签；也可以设置filename,filetag,filecontent等字段任意组合； 参数填写时参考es 索引的实际mapping，确保字段是索引中存在的字段 |
| `excludesFields` | `string` | — | 排除字段 多个以逗号分割，表示返回结果不包含设置的字段 |
| `highlightField` | `string` | — | 高亮字段 多个以逗号隔开，表示结果中匹配关键字的字符高亮 |
| `sort` | `string` | — | 排序字段 不填写按_score排序,排序字段只支持number、bool、日期、keyword 类型;text 类型字段默认不支持 对于文件索引的filename，filecode，fileremark和文件夹索引的foldername、foldercode、folderremark，以及元数据_t、_i、_s、_op类型的text类型字段，如果要作为排序字 |
| `order` | `string` | — | 排序方式，默认desc，可选值： * desc * asc |
| `moduleName` | `string` | — | 模块名称 模块维度保存历史搜索记录，默认空，不保存历史搜索记录，可自定义 |
| `isSynonymSearch` | `boolean` | — | 同义词搜索，统一搜索可配置同义词，若为true，则会进行同义词搜索 |
| `customWhere` | `string` | — | 自定义切面插槽高级搜索条件，后端该参数值会与SearchWhere参数的值用AND连接 |
| `fileSearchType` | `string` | — | 搜索类型，用于自动控制权限搜索范围。后端根据此值自动绑定 folderId/folderPath 并组装权限查询条件。 不传默认为all,表示查三库;可选值： * all 企业库、团队库、个人库（使用folderId=1/folderPath="1\\"作为企业库权限根，以及自动补全团队库权限根和个人库） * enterprise 仅企业库（自动绑定fold |
| `isPreciseSearch` | `boolean` | — | 是否精确检索 (默认true关键词分词需要全部匹配(AND)，false则满足其中一个分词即可（OR)) |
| `folderId` | `integer(int32)` | — | 文件夹id，默认1。如果不传值,该字段则由后端根据 FileSearchType 自动绑定;如果显式传值,则会使用传入值; 所以传入值要和实际搜索的库保持一致,避免出现FileSearchType=enterprise,但folderId传了9,这样不匹配就会查不出数据 默认绑定规则： * enterprise → folderId=1 * knowledg |
| `folderPath` | `string` | — | 文件夹路径，默认"1\\"。如果不传值,该字段则由后端根据 FileSearchType 自动绑定;如果显式传值,则会使用传入值; 所以显式传值要和实际搜索的库保持一致,避免出现FileSearchType=enterprise,但folderPath="9\\"的场景,这样不匹配就会查不出数据 默认绑定规则： * enterprise → folderPa |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据字段获取分段数据 folderId/folderPath 由 SDK 根据 FileSearchType 自动绑定。

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Search/GetSectionDataByField`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `pageIndex` | `integer(int32)` | — | 页码 默认1 `起始页从1开始` |
| `pageSize` | `integer(int32)` | — | 页面大小，默认20 `(范围 1-100)` |
| `indexName` | `string` | — | 索引库名称 默认file,可选值： * file * folder |
| `keyWord` | `string` | ✅ | 关键字 KeyWord只作用于文件名、文件标签、文件内容、文件夹名。如果只想搜元数据，KeyWord传*，元数据的条件需要在searchWhere中实现 |
| `searchWhere` | `string` | — | 高级搜索条件（可选），ES query string 格式。 根据 FileSearchType 补充权限路径条件，防止传入的 folderId/folderPath 与实际搜索类型不匹配导致数据越界 具体查询条件字段要根据你输入的IndexName 去查看对应索引库的字段名,以下以file索引字段为例: ``` ---------------------- |
| `searchFields` | `string` | — | 搜索字段多个以逗号分割，若SearchFields设置了字段则KeyWord匹配指定字段的字段值，若无则匹配所有字段值 默认：filename,filetag 表示搜索文件名，标签；也可以设置filename,filetag,filecontent等字段任意组合； 参数填写时参考es 索引的实际mapping，确保字段是索引中存在的字段 |
| `excludesFields` | `string` | — | 排除字段 多个以逗号分割，表示返回结果不包含设置的字段 |
| `highlightField` | `string` | — | 高亮字段 多个以逗号隔开，表示结果中匹配关键字的字符高亮 |
| `sort` | `string` | — | 排序字段 不填写按_score排序,排序字段只支持number、bool、日期、keyword 类型;text 类型字段默认不支持 对于文件索引的filename，filecode，fileremark和文件夹索引的foldername、foldercode、folderremark，以及元数据_t、_i、_s、_op类型的text类型字段，如果要作为排序字 |
| `order` | `string` | — | 排序方式，默认desc，可选值： * desc * asc |
| `moduleName` | `string` | — | 模块名称 模块维度保存历史搜索记录，默认空，不保存历史搜索记录，可自定义 |
| `isSynonymSearch` | `boolean` | — | 同义词搜索，统一搜索可配置同义词，若为true，则会进行同义词搜索 |
| `customWhere` | `string` | — | 自定义切面插槽高级搜索条件，后端该参数值会与SearchWhere参数的值用AND连接 |
| `fileSearchType` | `string` | — | 搜索类型，用于自动控制权限搜索范围。后端根据此值自动绑定 folderId/folderPath 并组装权限查询条件。 不传默认为all,表示查三库;可选值： * all 企业库、团队库、个人库（使用folderId=1/folderPath="1\\"作为企业库权限根，以及自动补全团队库权限根和个人库） * enterprise 仅企业库（自动绑定fold |
| `isPreciseSearch` | `boolean` | — | 是否精确检索 (默认true关键词分词需要全部匹配(AND)，false则满足其中一个分词即可（OR)) |
| `folderId` | `integer(int32)` | — | 文件夹id，默认1。如果不传值,该字段则由后端根据 FileSearchType 自动绑定;如果显式传值,则会使用传入值; 所以传入值要和实际搜索的库保持一致,避免出现FileSearchType=enterprise,但folderId传了9,这样不匹配就会查不出数据 默认绑定规则： * enterprise → folderId=1 * knowledg |
| `folderPath` | `string` | — | 文件夹路径，默认"1\\"。如果不传值,该字段则由后端根据 FileSearchType 自动绑定;如果显式传值,则会使用传入值; 所以显式传值要和实际搜索的库保持一致,避免出现FileSearchType=enterprise,但folderPath="9\\"的场景,这样不匹配就会查不出数据 默认绑定规则： * enterprise → folderPa |
| `facetLevel` | `integer(int32)` | — | 聚合层级，默认2,IsFacetFilePath=true时生效 |
| `isFacetFilePath` | `boolean` | — | 是否filepath聚合，默认true,为true则会按照FacetLevel参数设置的层级聚合，为false，则全聚合 |
| `isSelectFolderName` | `boolean` | — | 查询文件夹名称（为true则回显文件夹名称）,默认true |
| `sectionField` | `string` | — | 切面聚合字段 ，默认facetfilepath 如聚合文件路径：facetfilepath 聚合文件夹路径：folderpath |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 文件收集

### 完成收集任务

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/Complete`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 收集code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 删除收集任务

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/Delete`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 收集code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 下载范例文件

![GET](https://img.shields.io/badge/GET-61affe?style=flat-square) &nbsp; `/flatsdk/api/services/Task/DownloadExampleFile`

> 下载收集范例文件

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ |  |
| `collectCode` | ❓ query | `string` | ✅ |  |
| `fileKey` | ❓ query | `string` | ✅ |  |

</details>

<details>
<summary><b>Response</b></summary>

🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取文件扩展名列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/GetFileExtName`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取收集任务成员数量

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/GetMemberCount`

<details>
<summary><b>Request Params</b></summary>

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `token` | ❓ query | `string` | ✅ |  |
| `collectMember` | ❓ query | `string` | ✅ |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取收集任务详情

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/GetTaskInfo`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 收集code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取收集任务用户列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/GetUserList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 收集code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 我的收集任务列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/MyTaskList`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `keyword` | `string` | — | 搜索关键词，仅支持收集任务名称搜索 |
| `sortName` | `string` | — | 排序字段，支持createtime、title、status |
| `desc` | `boolean` | — | 排序方式 |
| `pageIndex` | `integer(int32)` | — | 页码 |
| `pageSize` | `integer(int32)` | — | 每页条数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
| `total` | `integer(int64)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 重新开始收集任务

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/ReStart`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 收集code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 保存收集任务

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/SaveTask`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | — | 收集任务code |
| `title` | `string` | ✅ | 标题 |
| `remark` | `string` | ✅ | 文件要求 |
| `folderId` | `integer(int32)` | ✅ | 存储目录 |
| `type` | `integer(int32)` | ✅ | 参与人类型（0：所有人；1.指定成员） |
| `beginTime` | `string(date-time)` | ✅ | 开始时间 |
| `endTime` | `string(date-time)` | ✅ | 结束时间 |
| `fileType` | `string` | — | 格式要求，多选拼接 1:文字文档,2:演示文稿,3:电子表格,4:pdf文档,5:图片,6:视频,7:音频,8:其他 |
| `fileMax` | `integer(int32)` | — | 文件最大数量 |
| `collectExamples` | `array[object]` | — | 范例文件 |
| `collectMember` | `string` | — | 指定成员，格式：membertype:memberId;membertype:memberId拼接 |
| `restart` | `boolean` | — | 是否重启，已停止收集的任务编辑时可以传true,用来开启任务 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 待我收集的任务列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/TaskToMe`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `keyword` | `string` | — | 搜索关键词，仅支持收集任务名称搜索 |
| `sortName` | `string` | — | 排序字段，支持createtime、title、status |
| `desc` | `boolean` | — | 排序方式 |
| `pageIndex` | `integer(int32)` | — | 页码 |
| `pageSize` | `integer(int32)` | — | 每页条数 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `array[object]` |  |
| `total` | `integer(int64)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 验证收集任务

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Task/Verify`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `code` | `string` | ✅ | 收集code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 模板

### 从模板创建文件

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/TemplateCreate/CreateFileFromTemplate`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `string` | ✅ | 文件夹id |
| `fileName` | `string` | ✅ | 文件名称 |
| `fileDesc` | `string` | — | //文件备注 |
| `type` | `string` | — | 文件类型（与 TemplateFileId 互斥，二选一），可选值： * .docx Word.docx * .xlsx Excel.xlsx * .pptx PowerPoint.pptx * .drawio Drawio.drawio * .mmind Mindmap.mmind |
| `templateFileId` | `string` | — | 自定义模板Id（与 Type 互斥，二选一） |
| `msgSource` | `string` | — | 10系统新建、vd/vbox不传默认10 |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 根据搜索获取分页子文件和缩略图列表

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/TemplateCreate/GetPagedChildFileAndThumbnailListBySearch`

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fId` | `integer(int32)` | — | 父文件夹ID |
| `pageNum` | `string` | — | 页码 |
| `pageSize` | `string` | — | 每页大小 |
| `extNames` | `string` | — | 扩展名（.doc,.docx,.ppt,.pptx） |
| `keyword` | `string` | — | 关键字 |
| `code` | `string` | — | 外发code |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 传输

### 下载前验证

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Transport/Download/DownloadCheck`

> 修改背景：安全缺陷，SDK 下载校验接口需与 V800 下载校验接口保持同样的 fileGuid/fileGuids 优先兼容策略。 修改人：wangtianyi 修改时间：2026-06-12 修改内容：SDK 请求模型同步支持 fileGuid/fileGuids，并继续兼容 fileId/fileIds。

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | — | ���ݾɸ��������ڲ��߼��;ɵ��÷����ļ����� ID������У������ʹ�� fileGuid�� |
| `fileGuid` | `string` | — | �ļ� GUID����ͨ���ļ����ء��������ء��ⷢ���ء����� PDF ��ʹ�ø��ֶΡ� |
| `mailCode` | `string` | — | AttachmentDownloaderCheck |
| `conversionKey` | `string` | — | ConvDownloaderCheck |
| `sourceFileVerId` | `integer(int64)` | — | DiffDownloaderCheck��������v66-�ϴ������Ż�-zhifeiya-20231220- �������صģ����� |
| `verId` | `integer(int64)` | — | DownloaderCheckBase��DiffDownloaderCheck��������v66-�ϴ������Ż�-zhifeiya-20231220- �������صģ����� |
| `fileIds` | `string` | — | ���ݾɵ��÷����ļ� ID �б�����������У������ʹ�� fileGuids�� |
| `fileGuids` | `string` | — | �ļ� GUID �б�������ļ�ʹ��Ӣ�Ķ��ŷָ��� |
| `merge` | `boolean` | — | ��������v66-�ϴ������Ż�-zhifeiya-20231220- �ϲ����صģ����� |
| `folderIds` | `string` | — | DownloaderCheckBase |
| `isIe` | `boolean` | — | DownloaderCheckBase |
| `regionId` | `integer(int32)` | — | DownloaderCheckBase |
| `code` | `string` | — | PublishFormatDownloaderCheck��PublishDownloaderCheck |
| `isPdfDownload` | `string` | — | PublishFormatDownloaderCheck |
| `shareCode` | `string` | — | ShareDownloaderCheck |
| `isConvDownLoad` | `string` | — | ConvDownloaderCheck |
| `notEncryped` | `boolean` | — |  |
| `isCheckScanning` | `boolean` | — |  |
| `permStr` | `string` | — | �ⲿȨ��p |
| `permCode` | `string` | — | �ⲿȨ��code |
| `needMessage` | `string` | — | ˮӡ��������windows���� |
| `codeKey` | `string` | — |  |
| `verify` | `string` | — |  |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `object` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 获取转档状态

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Transport/Download/GetFormatConvertStatus`

> 获取转档状态

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `fileId` | `integer(int64)` | — | �ļ�id |
| `fileVerId` | `integer(int64)` | — | �汾id�����ļ�id������ѡ��һ���汾id������Ч |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `integer(int32)` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>

---

### 上传前验证并创建文件信息

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Transport/Upload/CheckAndCreateDocInfo`

> 使用场景：上传文件时调用 上传参数form-data与6.6一样: folderId: 文件夹id|int|必传 masterFileId: 传空|string|可选 fileName:文件名|string|必传 fileRemark: 备注|string|可选 size: 大小|long|必填 type: 文件类型|string|必填 attachType:0|int|必填 code: strategy: 上传策略|string|可选 lastModifiedDate: 时间（yyyy-MM-dd HH:mm:ss格式）|string|必选 fileModel: 上传类型（UPLOAD：上传；UPGRADE：更新）|string|必选 返回值： {"availableSizes": 0, "data": {"FileId": 35, "FileVerId": 34, "RegionHash": "xxx|x", "OperaterId": 2, "ParentFolderId": 14, "RegionId": 1, "RegionType": 1, "RegionUrl": "http://localhost:6261", "StoragePlatform": 0, "IsSupportMultiTd": false }, "result": 0, "reason": ""}

<details>
<summary><b>Response</b></summary>

🟢 **200** OK — 返回类型：`object`
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>


## 水印

### 设置水印

![POST](https://img.shields.io/badge/POST-49cc90?style=flat-square) &nbsp; `/flatsdk/api/services/Watermark/SetWatermark`

> 保存水印策略

<details>
<summary><b>Request Body</b></summary>

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :---: | :---: | :--- |
| `token` | `string` | ✅ | 用户凭证 |
| `folderId` | `integer(int32)` | ✅ | 文件夹id |
| `inherit` | `boolean` | — | 水印策略是否向下继承 true：(inherit取值-->向下继承;false：不继承) |
| `inheritWatermarkId` | `integer(int32)` | — | 要继承的父级水印策略记录 |
| `watermarkCfg` | `string` | ✅ | 水印策略配置详情,示例： ``` 文字水印,示例 : sdk测试 16 #000000 4 15 10 10 2 0 7 content：xml 最外层节点 text：水印文本 size：字体大小 color：字体颜色 position:位置，写死为4 rotate:角度 translateX：x轴偏移量 translateY：y轴偏移量 tiled：平铺策 |
| `watermarkFiletype` | `string` | ✅ | 水印策略适用的文件类型 pdf: .pdf|.dwg|.dxf|.dwt; word: .doc|.docx|.dot|.dotx|.rtf; excel: .xls|.xlsx|.csv|.et|.ett; powerpoint: .ppt|.pptx|.pps; vision: .vsd|.vsdx; project: .mpp; image: .jpg |
| `watermarkName` | `string` | ✅ | 水印策略名称 |
| `watermarkType` | `integer(int32)` | — | 水印类型(0:文字，1：图片） |
| `displayType` | `integer(int32)` | — | 0文件流水印(v8不再支持) 1屏幕水印 2副本水印 3屏幕+副本 |
| `tiled` | `string` | ✅ | 平铺策略 (tiled取值-->1：普通;2：平铺） |

</details>

<details>
<summary><b>Response</b></summary>

🟢 **200** OK

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `result` | `integer(int32)` |  |
| `msg` | `string` |  |
| `data` | `string` |  |
🔴 **403** Forbidden

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **401** Unauthorized

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **400** Bad Request

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **404** Not Found

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **501** Not Implemented

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |
🔴 **500** Internal Server Error

| 字段名 | 类型 | 说明 |
| :--- | :---: | :--- |
| `error` | `object` |  |

</details>



---

## 文件上传之表单上传

### 1.上传流程图

![上传流程图](data:image/png;base64,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)

### 2.文字说明

1．客户端携带约定的参数发送上传请求到主站点，主站点接收到上传请求后，执行上传规则的运算，返回一个文件实际要存储区域的结果（包括一个存储区域的请求地址）。
 2．客户端得到主站点返回的存储区域结果后，发送文件流至指定的存储区域中。

### 3. 接口说明

#### 第一步：发送上传请求

客户端携带约定的参数发送上传请求到主站点，作用：验证参数、创建文件或版本，返回实际要存储的区域结果对象。

#### 请求地址：

http://{主站点}/FlatDms/V800/Transport/Upload/CheckAndCreateDocInfo

#### 参数：

| 参数名称 | 类型 | 必传 | 说明 |
| --- | --- | --- | --- |
| folderId | int | ✅ | 要上传到的文件夹编号 |
| token | string | — | 登录者的token信息 |
| fileName | string | ✅ | 文件名称(例如：XXXX文档.docx) |
| fileRemark | string | — | 文件备注或描述 |
| size | long | ✅ | 文件大小 |
| type | string | ✅ | 文件的contentType例如image/jpeg |
| attachType | int | ✅ | 默认传入0 (目前只有0) |
| fullPath | string | — | 携带文件夹上传，会自动创建文件夹（例:/文件夹1/文件夹2/） |
| code | string | — | 外发code |
| masterFileId | int | — | 附件的主文件编号(如果上传的是附件时传入) |
| fileId | int | — | 更新的文件编号 |
| strategy | string | — | 更新策略，默认传majorUpgrade |
| fileModel | string | ✅ | 本次是新上传文件还是更新文件两个值"UPDATE" or "UPLOAD" |
| fileMd5 | string | — | 文件的md5值，用于判断是否秒传，具体参照"秒传"小节 |

#### 返回值

##### 正确返回结果

```
{
  result: 0,        // 错误码，值=0时表示调用成功
  reason:"",        // 未成功调用时的具体原因，值=0时为空
  data: {
    FileId,                 // 上传或更新的文件编号
    FileVerId,        // 上传或更新的文件版本
    ParentFolderId, // 文件的父文件夹编号
    RegionHash,        // 本次上传或更新操作的Hash码
    RegionId,                // 区域编号
    RegionType,   // 区域类型，1：主区域，2：分区域
    RegionUrl                // 区域站点地址，RegionType=1时，为空
  },
  secondPass: false,  // 当请求参数中传入了fileMd5值时，会去验证是否需要秒传。如果秒传了则
  secondPass=true 返之false,当等于true时，就不需要再请求第二步传输流，文件直接上传成功。
}
```

##### 错误返回结果

```
{
  result: 610,        // 错误码（值不等于0的各种可能）
  reason: "" // 错误原因，例如：文件夹不存在等
}
```

#### 第二步：传输流

#### 请求地址

http://{ uploadServer}/document/upload?code= &token=

#### 说明

通过第一步得到的RegionUrl，到指定的站点地址上传文件流。

```
var uploadServer = "";
 if (RegionType == 1) { // 主区域
    1. 如果是web端，当前浏览器的访问域名，也可以用相对地址
    2. 如果是Vdrive端，就是登录Vdrive的地址
    3. 其他…
} else { // 分区域
   uploadServer = RegionUrl;
}
```

#### 参数

| 参数名称 | 类型 | 必传 | 说明 |
| --- | --- | --- | --- |
| uploadId | string | ✅ | 本次上传的key值，一般用Guid唯一，不可重复 |
| regionHash | string | ✅ | 由第一步中返回得到 |
| regionId | int | ✅ | 区域编号，由第一步中返回得到 |
| fileName | string | ✅ | 文件名称 |
| size | long | ✅ | 文件大小 |
| fileMd5 | long | — | 用于判断是否秒传，具体参照"秒传"小节 |
| chunks | int | ✅ | 一共几块例如：如果 chunkSize= 5242880，一个文件共13M，则chunks=3 |
| chunk | int | ✅ | 本次请求传入的是第几块下标从0开始 |
| chunkSize | long | ✅ | 分块大小（默认传5242880） |
| blockSize | long | ✅ | 本次请求传入的块大小例如：如果chunkSize=5242880，一个文件共13M，分3次请求传入，前两次各传5M，最后一次传3M。 |
| file | binary | ✅ | 本次请求传入的文件字节，该参数必须是最后一个参数 |

#### 返回值

```
{
  uploadId:"8f7ae0f3-3ac1-0d5e-475d-8762a7e07d73", // 本次上传的key值
  filename: "02EE.jpg", // 文件名
  status:"End", // 状态 Begin:开始,Uploading:上传中,Error: 出错, End:结束，Cancel：取消
  message: null, // 当status=Error时，错误信息
  percent: 100,  // 当前的上传进度
  tag: false  // 是否秒传，值=true代表秒传，则剩下的块可以不用再传输，直接上传完毕
}
```

### 秒传

#### 第一种：

在第一步时就传入了fileMd5参数，结果中的secondPass=true表示秒传，不必再上传文件流了。

#### 第二种：

在第一步时未传入fileMd5参数，而是在第二步边上传文件块，边计算fileMd5值，当文件的md5算完以后在下一个块的请求中将fileMd5参数传入，在返回结果中的tag属性中判断是否秒传，如果tag=true，表示秒传，则剩下的块可以不用再传输，直接上传完毕。

### 续传

客户端将第一步请求得到的返回信息缓存起来，用RegionHash当key值，或某个文件需要续传时，以该key值得到文件的信息、区域地址等，重新请求第二步的接口上传文件块，如果正确返回则表示续传成功，返之重新上传该文件。


---

## 文件下载

### 1.下载流程图

![下载流程图](data:image/png;base64,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)

### 2.文字说明

1．客户端携带约定的参数发送下载请求到主站点，主站点接收到下载请求后，执行就近下载规则的运算，返回文件实际从哪里下载的存储区域的结果（包括一个存储区域的请求地址）。
2．客户端得到主站点返回的存储区域结果后，发送至指定的区域中拉取文件。

```
a.如果是下载单文件，则直接输出文件流
b.如果是批量下载，则将文件压缩成包
```

3．批量下载时，需要再次请求一次获得压缩包的接口。

### 3.接口说明

#### 第一步：发送下载请求

客户端携带约定的参数发送下载请求到主站点，作用：验证参数，返回实际下载的存储的区域结果。

#### 请求地址：

http://{主站点}/FlatDms/V800/Transport/Download/DownloadCheck

#### 参数：

##### 单文件下载参数，参数fileIds和ver_id互斥，二选一做为单文件下载的条件

##### 副本下载，需传参ispdfdownload=true

##### 当cookie中不包含token时，token参数必须放在url上,如：http://{主站点}/FlatDms/V800/Transport/Download/DownloadCheck?token=xxx

| 参数名称 | 类型 | 必传 | 说明 |
| --- | --- | --- | --- |
| fileIds | string | ✅ | 下载的文件编号 |
| ver_id | int | ✅ | 下载的文件版本编号 |
| token | string | — | 放在url上或cookie中 |
| r |  | — | 随机数，防缓存 |
| code | string | — | 外发codeSDK不要支持外发下载的参数 |
| shareCode | int | — | 共享code |
| ispdfdownload | string | — | 是否导出PDF |

##### 批量下载参数

http://{主站点}/FlatDms/V800/Transport/Download/DownloadCheck

| 参数名称 | 类型 | 必传 | 说明 |
| --- | --- | --- | --- |
| fileIds | string | ✅ | 下载的文件编号，逗号","分隔 |
| folderIds | string | ✅ | 下载的文件夹，逗号","分隔 |
| token | string | — | 放在url上或cookie中 |
| code | string | — | 外发codeSDK不要开放下载的参数 |
| shareCode | string | — | 共享code |

#### 返回值

##### 正确返回结果

```
{
  result, // 错误码，值=0表示成功
  msg,                // 外发里$&quot; etc..{outLength}&quot;;//这个是约定格式，前端将etc.. 解析为等
  data:{
      regionId, // 区域编号
      regionType, // 区域类型,1: 主区域，2: 分区域
      regionHash, // 本次下载的hash码
      regionUrl   // 区域地址（RegionType=1时为空）
  }
}
```

##### 错误的返回结果

```
{
  result // 非0的各种情况
}
```

#### 第二步：下载流

##### 请求地址

http://{uploadServer}/downLoad/index?regionHash=&其他...

##### 说明

通过第一步得到的RegionUrl，到指定的站点地址下载文件。

```
var uploadServer ="";
 if (RegionType == 1) { // 主区域
  1．如果是web端，当前浏览器的访问域名，也可以用相对地址
  2．如果是Vdrive端，就是登录Vdrive的地址
} else { // 分区域
   uploadServer = RegionUrl;
}
```

##### 参数

与第一步的发送下载请求的参数保持一致，多增加以下参数

| 参数名称 | 类型 | 必传 | 说明 |
| --- | --- | --- | --- |
| regionHash | string | ✅ | 由第一步的请求返回得到 |
| tar | bool | — | 批量下载必传true,非批量下载不加此参数 |

## 导出PDF

导出PDF，需要文件转档成功才能下载成功。下载之前，需要确保转档成功后才能调用下载接口/downLoad/index
导出PDF，分为三步执行：

#### 第一步：发送下载请求

同普通下载接口请求地址一致，入参增加ispdfdownload=true

#### 请求地址：

http://{主站点}/FlatDms/V800/Transport/Download/DownloadCheck

#### 参数：

##### 单文件下载参数，参数fileIds和ver_id互斥，二选一做为单文件下载的条件

##### 导出PDF，传参ispdfdownload=true

| 参数名称 | 类型 | 必传 | 说明 |
| --- | --- | --- | --- |
| fileIds | string | ✅ | 下载的文件编号 |
| ver_id | int | ✅ | 下载的文件版本编号 |
| token | string | — | 放在url上或cookie中 |
| r |  | — | 随机数，防缓存 |
| code | string | — | 外发codeSDK不要支持外发下载的参数 |
| shareCode | int | — | 共享code |
| ispdfdownload | string | — | 是否导出PDF |

#### 返回值

##### 正确返回结果

```
{
  result, // 错误码，值=0表示成功
  msg,                // 外发里$&quot; etc..{outLength}&quot;;//这个是约定格式，前端将etc.. 解析为等
  data:{
      regionId, // 区域编号
      regionType, // 区域类型,1: 主区域，2: 分区域
      regionHash, // 本次下载的hash码
      regionUrl,   // 区域地址（RegionType=1时为空）
      conversionState  //转档状态 （conversionState=1转档成功，可以直接调用download/index进行下载，否则需要调用获取转档状态接口）
  }
}
```

#### 第二步：获取转档状态接口请求

DownloadCheck接口返回值ConversionState=1时，可以跳过第二步。
如果接口返回转档状态等于1，说明转档成功，可以调用下载接口；
如果接口返回转档状态等于0、1024，说明无法转档或者转档失败，下载逻辑中止，可以提示副本文件下载失败。
如果接口返回转档状态等于5000、5100、5200、5300，说明文件还在转档中，2秒后再次调用GetFormatConvertStatus接口。

#### 请求地址：

http://{主站点}/FlatDms/V800/Transport/Download/GetFormatConvertStatus

##### 参数

| 参数名称 | 类型 | 必传 | 说明 |
| --- | --- | --- | --- |
| FileVerId | long | ✅ | 文件版本ID |

##### 返回值

```
{
  result: 错误码，值=0表示成功
  data: 1  //文件转档状态，0：无状态，1：转档成功，1024：转档错误，5000：准备转档，5100：转档中，5200：无需转档，5300：优先转档
}
```

#### 第三步：下载副本文件流

与普通下载相比，新增参数ispdfdownload=true

##### 请求地址

http://{uploadServer}/downLoad/index?ispdfdownload=true&regionHash=&其他...
