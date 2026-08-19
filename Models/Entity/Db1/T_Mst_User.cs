using Microsoft.AspNetCore.Identity;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace WebApplicationBase.Models.Entity.Db1
{
    [Table("T_Mst_User")]
    public class T_Mst_User : IdentityUser<int>
    {
        [DefaultValue(0)]
        public short I_Autholity_Cls { get; set; }
        [DefaultValue(0)]
        public int I_Tanto_Ku { get; set; }
        [MaxLength(18)]
        public string? I_User_Na { get; set; }
        [MaxLength(18)]
        public string? I_User_Na_K { get; set; }
        [DefaultValue(0)]
        public short I_User_Sex { get; set; }
        public DateTime? I_User_Birthday { get; set; }
        [MaxLength(16)]
        public string? I_Password { get; set; }
        public DateTime? I_Abolition_Date { get; set; }
        public string? I_Biko { get; set; }
        public short I_Alert_Day { get; set; }
        public int I_Update_No { get; set; }
        public DateTime I_Reg_Date_Time { get; set; }
        [MaxLength(8)]
        public int I_Reg_Operator { get; set; }
        public DateTime I_Upd_Date_Time { get; set; }
        [MaxLength(8)]
        public int I_Upd_Operator { get; set; }
    }
}
