using Microsoft.AspNetCore.Identity;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace WebApplicationBase.Models.Entity.Db2
{
    [Table("T_Mst_Etc")]
    public class T_Mst_Etc
    {
        [Key]
        [Required, DatabaseGenerated(DatabaseGeneratedOption.None), DefaultValue(0)]
        public int Mst_Id { get; set; }
        [Required, DefaultValue(0)]
        public int Mst_Key1 { get; set; }
        [Required, DefaultValue(0)]
        public int Mst_Key2 { get; set; }
        [DefaultValue(0)]
        public int? Mst_Sort { get; set; }
        public int Mst_Lng1 { get; set; }
        public int Mst_Lng2 { get; set; }
        [Column(TypeName = "decimal(18, 2)")]
        public decimal? Mst_Cur1 { get; set; }
        [Column(TypeName = "decimal(18, 2)")]
        public decimal? Mst_Cur2 { get; set; }
        [MaxLength(100)]
        public string? Mst_txt1 { get; set; }
        [MaxLength(100)]
        public string? Mst_txt2 { get; set; }
        [MaxLength(100)]
        public string? Mst_txt3 { get; set; }
        public string? Mst_Memo1 { get; set; }
        public string? Mst_Memo2 { get; set; }
        public string? Mst_Memo3 { get; set; }
        [DefaultValue(0)]
        public short? Mst_FlgDel { get; set; }
        public DateTime? Mst_Abolition_Date { get; set; }
        public DateTime I_Reg_Date_Time { get; set; }
        public int I_Reg_Operator { get; set; }
        public DateTime I_Upd_Date_Time { get; set; }
        public int I_Upd_Operator { get; set; }
    }
}
